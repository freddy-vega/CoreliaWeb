const express = require('express');
const router = express.Router();
const {
  getWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  addMember,
  removeMember
} = require('../controllers/workspaceController');
const { protect } = require('../middlewares/auth');

router.use(protect);

router.route('/')
  .get(getWorkspaces)
  .post(createWorkspace);

router.route('/:id')
  .get(getWorkspace)
  .put(updateWorkspace)
  .delete(deleteWorkspace);

router.post('/:id/members', addMember);
router.delete('/:id/members', removeMember);

module.exports = router;
