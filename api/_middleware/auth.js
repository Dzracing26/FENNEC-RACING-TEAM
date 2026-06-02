import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export function verifyJWT(token) {
try {
const [header, payload, sig] = token.split('.');
const expectedSig = crypto
.createHmac('sha256', process.env.JWT_SECRET)
.update(`${header}.${payload}`)
.digest('base64url');
if (sig !== expectedSig) return null;
const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
if (data.exp < Math.floor(Date.now() / 1000)) return null;
return data;
} catch {
return null;
}
}

export function getTokenFromRequest(req) {
const cookies = req.headers.cookie || '';
const match = cookies.match(/frt_token=([^;]+)/);
if (match) return match[1];
const auth = req.headers.authorization || '';
if (auth.startsWith('Bearer ')) return auth.slice(7);
return null;
}

export async function requireAuth(req, res) {
const token = getTokenFromRequest(req);
if (!token) {
res.status(401).json({ error: 'Non authentifié.' });
return null;
}
const payload = verifyJWT(token);
if (!payload) {
res.status(401).json({ error: 'Session expirée.' });
return null;
}
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
const { data: session } = await supabase
.from('sessions')
.select('id')
.eq('token_hash', tokenHash)
.gt('expires_at', new Date().toISOString())
.single();
if (!session) {
res.status(401).json({ error: 'Session révoquée.' });
return null;
}
return payload;
}

export async function requireAdmin(req, res) {
const user = await requireAuth(req, res);
if (!user) return null;
if (!user.is_admin) {
res.status(403).json({ error: 'Accès refusé.' });
return null;
}
return user;
}

export async function requireMember(req, res) {
const user = await requireAuth(req, res);
if (!user) return null;
if (!user.is_member) {
res.status(403).json({ error: 'Vous devez être membre du Discord FRT.' });
return null;
}
return user;
}
