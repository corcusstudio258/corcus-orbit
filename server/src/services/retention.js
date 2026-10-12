// Deletes review data (pinned feedback, comment images, reviewed images and videos)
// some days after a project is completed, to keep storage in check.
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { Project, Task, Comment, Attachment } = require('../models');
const settings = require('./settings');

const UPLOAD_DIR = path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || './uploads');
const MEDIA = /^(image|video)\//;

async function retentionDays() {
  const c = await settings.get('company');
  const n = Number(c?.reviewRetentionDays ?? 30);
  return Number.isFinite(n) ? n : 30;
}

/** Removes one project's review data. Returns counts. */
async function purgeProject(project) {
  const taskIds = (await Task.findAll({ where: { projectId: project.id }, attributes: ['id'], raw: true })).map((t) => t.id);
  let comments = 0; let files = 0; let freed = 0;
  if (taskIds.length) {
    const reviewComments = await Comment.findAll({ where: { taskId: taskIds, kind: 'review' }, attributes: ['id', 'attachmentId'], raw: true });
    const reviewedIds = new Set(reviewComments.map((c) => c.attachmentId).filter(Boolean));
    const all = await Attachment.findAll({ where: { taskId: taskIds }, raw: true });
    const doomed = all.filter((a) => a.commentId != null || (MEDIA.test(a.mime || '') && (a.forReview || reviewedIds.has(a.id)
      || (a.clientReviewStatus && a.clientReviewStatus !== 'none') || (a.reviewStatus && a.reviewStatus !== 'pending'))));
    if (doomed.length) {
      await Attachment.destroy({ where: { id: doomed.map((a) => a.id) } });
      for (const a of doomed) { freed += a.size || 0; fs.promises.unlink(path.join(UPLOAD_DIR, a.fileName)).catch(() => {}); }
    }
    if (reviewComments.length) await Comment.destroy({ where: { id: reviewComments.map((c) => c.id) } });
    comments = reviewComments.length; files = doomed.length;
  }
  project.reviewPurgedAt = new Date(); await project.save();
  return { projectId: project.id, comments, files, freed };
}

/** Purges every completed project past the retention window. */
async function purgeExpired({ now = new Date() } = {}) {
  const days = await retentionDays();
  if (days <= 0) return [];
  const cutoff = new Date(now.getTime() - days * 86400e3);
  const projects = await Project.findAll({ where: { status: 'completed', reviewPurgedAt: null, completedAt: { [Op.lte]: cutoff } } });
  const out = [];
  for (const p of projects) {
    const r = await purgeProject(p);
    console.log(`[retention] ${p.name}: removed ${r.files} files and ${r.comments} review notes`);
    out.push(r);
  }
  return out;
}

/** When a completed project's review data will be deleted (null if never). */
async function purgeDate(project) {
  if (project.status !== 'completed' || !project.completedAt || project.reviewPurgedAt) return null;
  const days = await retentionDays();
  return days > 0 ? new Date(new Date(project.completedAt).getTime() + days * 86400e3) : null;
}

module.exports = { purgeExpired, purgeProject, purgeDate, retentionDays };
