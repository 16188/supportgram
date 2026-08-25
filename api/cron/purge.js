// Kept as a compatibility endpoint for old Vercel deployments. Data retention is indefinite.
export default function handler(_req, res) {
  return res.status(410).json({ error: 'automatic data purge is disabled' });
}
