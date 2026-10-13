/**
 * GET /api/files/:id — serves an uploaded file stored in the database.
 * Requires the inbox login (ids are sequential, so links are not secret).
 */
import { Router } from 'express';
import { asyncHandler, getCookie, inboxToken } from '../lib.js';
import { getFile } from '../db.js';

export const filesRouter = Router();

filesRouter.get(
  '/api/files/:id',
  asyncHandler(async (req, res) => {
    const password = process.env.INBOX_PASSWORD;
    if (!password || getCookie(req, 'fikra_inbox') !== inboxToken(password)) {
      return res.status(404).send('Not found');
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(404).send('Not found');
    }

    const file = await getFile(id);
    if (!file) {
      return res.status(404).send('Not found');
    }

    res.setHeader('Content-Type', file.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(file.bytes);
  }),
);
