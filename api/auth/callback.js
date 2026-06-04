import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateJWT(payload) {
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const body = Buffer.from(JSON.stringify({
...payload,
iat: Math.floor(Date.now() / 1000),
exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
})).toString('base64url');
const sig = crypto
.createHmac('sha256', process.env.JWT_SECRET)
.update(`${header}.${body}`)
.digest('base64url');
return `${header}.${body}.${sig}`;
}

export default async function handler(req, res) {
const { code, error } = req.query;
if (error || !code) return res.redirect('/?auth=error');
try {
const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
method: 'POST',
headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
body: new URLSearchParams({
client_id: process.env.DISCORD_CLIENT_ID,
client_secret: process.env.DISCORD_CLIENT_SECRET,
grant_type: 'authorization_code',
code,
redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/callback`,
}),
});
if (!tokenRes.ok) throw new Error('Token exchange failed');
const tokens = await tokenRes.json();
const userRes = await fetch('https://discord.com/api/users/@me', {
headers: { Authorization: `Bearer ${tokens.access_token}` },
});
if (!userRes.ok) throw new Error('Failed to fetch Discord user');
const discordUser = await userRes.json();
const memberRes = await fetch(
`https://discord.com/api/users/@me/guilds/${process.env.DISCORD_SERVER_ID}/member`,
{ headers: { Authorization: `Bearer ${tokens.access_token}` } }
);
const isMember = memberRes.ok;
const isAdmin = discordUser.id === process.env.ADMIN_DISCORD_ID;
const { data: pilot } = await supabase
.from('pilots')
.select('id, race_number, is_admin')
.eq('discord_id', discordUser.id)
.single();
const jwt = generateJWT({
discord_id: discordUser.id,
discord_username: discordUser.username,
discord_avatar: discordUser.avatar,
is_member: isMember,
is_admin: isAdmin || (pilot?.is_admin ?? false),
pilot_id: pilot?.id ?? null,
race_number: pilot?.race_number ?? null,
psn_id: pilot?.psn_id ?? null, 
})
const tokenHash = crypto.createHash('sha256').update(jwt).digest('hex');
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
await supabase.from('sessions').insert({
discord_id: discordUser.id,
token_hash: tokenHash,
expires_at: expiresAt.toISOString(),
});
res.setHeader('Set-Cookie', [
`frt_token=${jwt}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${7 * 24 * 3600}`,
`frt_user=${encodeURIComponent(JSON.stringify({
username: discordUser.username,
avatar: discordUser.avatar,
id: discordUser.id,
is_admin: isAdmin,
is_member: isMember,
race_number: pilot?.race_number ?? null,
}))}; Secure; SameSite=None; Path=/; Max-Age=${7 * 24 * 3600}`
]);
res.redirect('/?auth=success');
} catch (err) {
console.error('Auth error:', err);
res.redirect('/?auth=error');
}
}
