const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const User = require('../models/User');
const { adminAuth } = require('../middleware/auth');

// @route   GET /api/admin/stats
// @desc    Get admin dashboard stats
// @access  Admin
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalNotes = await Note.countDocuments();
    const totalDownloads = await Note.aggregate([
      { $group: { _id: null, total: { $sum: '$downloads' } } }
    ]);
    const pendingNotes = await Note.countDocuments({ isApproved: false });

    const recentNotes = await Note.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('uploadedBy', 'name');

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalNotes,
        totalDownloads: totalDownloads[0]?.total || 0,
        pendingNotes
      },
      recentNotes
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/notes
// @desc    Get all notes for admin
// @access  Admin
router.get('/notes', adminAuth, async (req, res) => {
  try {
    const notes = await Note.find()
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'name email');

    res.json({
      success: true,
      notes
    });
  } catch (error) {
    console.error('Admin notes error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/admin/notes/:id
// @desc    Delete a note
// @access  Admin
router.delete('/notes/:id', adminAuth, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    await Note.findByIdAndDelete(req.params.id);

    // Remove from user's uploaded notes
    await User.findByIdAndUpdate(note.uploadedBy, {
      $pull: { uploadedNotes: note._id }
    });

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/admin/notes/:id/approve
// @desc    Approve/reject a note
// @access  Admin
router.put('/notes/:id/approve', adminAuth, async (req, res) => {
  try {
    const { isApproved } = req.body;
    const note = await Note.findByIdAndUpdate(
      req.params.id,
      { isApproved },
      { new: true }
    );

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    res.json({
      success: true,
      message: `Note ${isApproved ? 'approved' : 'rejected'} successfully`,
      note
    });
  } catch (error) {
    console.error('Approve note error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users
// @access  Admin
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/admin/users/:id/role
// @desc    Update user role
// @access  Admin
router.put('/users/:id/role', adminAuth, async (req, res) => {
  try {
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      success: true,
      message: 'User role updated successfully',
      user
    });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
