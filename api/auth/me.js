import { verifyJWT, getTokenFromRequest } from '../_middleware/auth.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_SITE_URL);
res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') return res.status(200).end();

const token = getTokenFromRequest(req);
if (!token) return res.status(401).json({ error: 'Non authentifié.' });

const user = verifyJWT(token);
if (!user) return res.status(401).json({ error: 'Session expirée.' });
  
  const { data: pilot } = await supabase
.from('pilots')
.select('*')
.eq('discord_id', user.discord_id)
.single();

return res.status(200).json({ user: { ...user, ...pilot } });
}
