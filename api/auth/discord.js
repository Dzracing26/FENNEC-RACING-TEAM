export default function handler(req, res) {
if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

const params = new URLSearchParams({
client_id: process.env.DISCORD_CLIENT_ID,
redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/callback`,
response_type: 'code',
scope: 'identify guilds.members.read',
});

res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
}
