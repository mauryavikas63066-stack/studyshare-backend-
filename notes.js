const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Note = require('../models/Note');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const path = require('path');

// @route   POST /api/notes/upload
// @desc    Upload a new note
// @access  Private
router.post('/upload', auth, upload.single('file'), [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('subject').trim().notEmpty().withMessage('Subject is required'),
  body('category').isIn(['Notes', 'PYQ', 'Study Material', 'Assignment', 'Other']).withMessage('Invalid category')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Please upload a file' });
    }

    const { title, description, subject, category, tags } = req.body;

    const note = await Note.create({
      title,
      description,
      subject,
      category,
      fileUrl: `/uploads/${req.file.filename}`,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      uploadedBy: req.user.id,
      uploaderName: req.user.name,
      tags: tags ? tags.split(',').map(tag => tag.trim()) : []
    });

    // Add to user's uploaded notes
    await User.findByIdAndUpdate(req.user.id, {
      $push: { uploadedNotes: note._id }
    });

    res.status(201).json({
      success: true,
      message: 'Note uploaded successfully',
      note
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Server error during upload' });
  }
});

// @route   GET /api/notes
// @desc    Get all notes with search and filter
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { search, subject, category, sortBy, page = 1, limit = 12 } = req.query;

    const query = { isApproved: true };

    // Search functionality
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    if (subject) {
      query.subject = { $regex: subject, $options: 'i' };
    }

    if (category) {
      query.category = category;
    }

    // Sorting
    let sortOption = {};
    switch (sortBy) {
      case 'rating':
        sortOption = { averageRating: -1 };
        break;
      case 'downloads':
        sortOption = { downloads: -1 };
        break;
      case 'newest':
        sortOption = { createdAt: -1 };
        break;
      case 'oldest':
        sortOption = { createdAt: 1 };
        break;
      default:
        sortOption = { createdAt: -1 };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notes = await Note.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('uploadedBy', 'name');

    const total = await Note.countDocuments(query);

    res.json({
      success: true,
      notes,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalNotes: total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/notes/:id
// @desc    Get single note
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const note = await Note.findById(req.params.id)
      .populate('uploadedBy', 'name email');

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    res.json({
      success: true,
      note
    });
  } catch (error) {
    console.error('Get note error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/notes/:id/download
// @desc    Download a note
// @access  Private
router.post('/:id/download', auth, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    // Increment download count
    note.downloads += 1;
    await note.save();

    // Add to user's downloaded notes
    await User.findByIdAndUpdate(req.user.id, {
      $addToSet: { downloadedNotes: note._id }
    });

    res.json({
      success: true,
      fileUrl: note.fileUrl,
      fileName: note.fileName
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/notes/:id/rate
// @desc    Rate a note
// @access  Private
router.post('/:id/rate', auth, [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { rating } = req.body;
    const note = await Note.findById(req.params.id);

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    // Check if user already rated
    const existingRating = note.ratings.find(
      r => r.user.toString() === req.user.id
    );

    if (existingRating) {
      existingRating.rating = rating;
    } else {
      note.ratings.push({ user: req.user.id, rating });
    }

    // Recalculate average
    const sum = note.ratings.reduce((acc, item) => acc + item.rating, 0);
    note.averageRating = Math.round((sum / note.ratings.length) * 10) / 10;
    note.totalRatings = note.ratings.length;

    await note.save();

    res.json({
      success: true,
      message: 'Rating submitted successfully',
      averageRating: note.averageRating,
      totalRatings: note.totalRatings
    });
  } catch (error) {
    console.error('Rate error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/notes/subjects/list
// @desc    Get all unique subjects
// @access  Public
router.get('/subjects/list', async (req, res) => {
  try {
    const subjects = await Note.distinct('subject', { isApproved: true });
    res.json({
      success: true,
      subjects
    });
  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
