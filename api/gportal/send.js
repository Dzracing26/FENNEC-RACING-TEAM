import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
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
.select('race_number, psn_id, discord_username, platform_uid')
.in('id', pilotIds);

if (err2) return res.status(500).json({ error: err2.message });

if (type === 'entrylist') {
const parts = (p) => {
const name = p.psn_id || p.discord_username || 'Pilote';
const split = name.indexOf('_');
const firstName = split > -1 ? name.substring(0, split) : name;
const lastName = split > -1 ? name.substring(split + 1) : '';
const shortName = lastName.substring(0, 3).toUpperCase() || firstName.substring(0, 3).toUpperCase();
return { firstName, lastName, shortName };
};

const entrylist = {
entries: pilots.map(p => {
const { firstName, lastName, shortName } = parts(p);
return {
drivers: [
{
firstName,
lastName,
shortName,
nationality: 1,
driverCategory: 2,
helmetTemplateKey: 500,
helmetBaseColor: 0,
helmetDetailColor: 0,
helmetMaterialType: 0,
helmetGlassColor: 0,
helmetGlassMetallic: 0.0,
glovesTemplateKey: 2,
suitTemplateKey: 500,
suitDetailColor1: 40,
suitDetailColor2: 160,
playerID: p.platform_uid || ''
}
],
raceNumber: p.race_number,
defaultGridPosition: -1,
forcedCarModel: -1,
overrideDriverInfo: 1,
isServerAdmin: 0,
configVersion: 0
};
}),
configVersion: 1
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
}
