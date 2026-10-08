import { colors } from '../theme';

// What kind of data is the user looking at? Nothing in this prototype is an official real-time warning.
//   offline  -> built-in demo data (server unreachable)
//   DEMO_SEED / SIMULATED -> what the backend says about its own data
export function dataLabel(source, risk) {
  if (source !== 'live') return { text: 'DEMO DATA', color: colors.MEDIUM, note: 'Offline demo data. Not real-world information.' };
  if (risk && risk.dataSource === 'SIMULATED') return { text: 'SIMULATED DATA', color: '#7C3AED', note: 'Simulated rainfall for a demo. Not an official warning.' };
  if (risk && risk.dataSource === 'LIVE') return { text: 'LIVE DATA', color: colors.LOW, note: 'Live readings.' };
  return { text: 'DEMO DATA', color: colors.MEDIUM, note: 'Seeded demo data. Not an official warning.' };
}
