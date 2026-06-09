const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

const { type, event_id } = req.body;

if (!event_id) return res.status(400).json({ error: 'event_id requis' });

try {
const { data: regs, error: err1 } = await supabase
.from('registrations')
.select('pilot_id')
.eq('event_id', event_id)
.eq('status', 'confirmed');

if (err1) return res.status(500).json({ error: err1.message });
if (!regs.length) return res.status(200).json({ message: 'Aucun pilote inscrit', content: '' });

const pilotIds = regs.map(r => r.pilot_id);

const { data: pilots, error: err2 } = await supabase
.from('pilots')
.select('race_number, psn_id, discord_username, platform_uid, platform, gamertag')
.in('id', pilotIds);

if (err2) return res.status(500).json({ error: err2.message });

if (type === 'entrylist') {
const entrylist = {
entries: pilots.map(p => ({
drivers: [
{
playerID: (p.platform === 'xbox' ? 'M' : 'S') + p.platform_uid,
lastName: p.gamertag || p.psn_id || p.discord_username || 'Pilote',
driverCategory: 2
}
],
raceNumber: p.race_number,
forcedCarModel: -1,
overrideDriverInfo: 1,
isServerAdmin: 0,
overrideCarModelForCustomCar: true
})),
forceEntryList: 1
};

return res.status(200).json({
message: 'Entry list générée avec succès !',
content: JSON.stringify(entrylist, null, 2)
});
}

return res.status(400).json({ error: 'Type invalide' });

} catch (e) {
return res.status(500).json({ error: e.message });
}
};
