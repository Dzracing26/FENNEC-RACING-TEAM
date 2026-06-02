import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getTokenFromRequest(req) {
const cookies = req.headers.cookie || '';
const match = cookies.match(/frt_token=([^;]+)/);
if (match) return match[1];
const auth = req.headers.authorization || '';
if (auth.startsWith('Bearer ')) return auth.slice(7);
return null;
}

export default async function handler(req, res) {
if (req.method !== 'POST') return res.status(405).end();
const token = getTokenFromRequest(req);
if (token) {
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
await supabase.from('sessions').delete().eq('token_hash', tokenHash);
}
res.setHeader('Set-Cookie', [
'frt_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
'frt_user=; Secure; SameSite=Strict; Path=/; Max-Age=0'
]);
res.status(200).json({ success: true });
}
