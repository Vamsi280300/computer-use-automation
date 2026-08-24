// In-memory data store for the mock servicing tool.
// All members are invented for testing purposes.

export const members = [
  { id: '100241', name: 'Marisol Trevino',    savings:  4820.55, status: 'active' },
  { id: '100242', name: 'Desmond Okafor',     savings:   172.00, status: 'active' },
  { id: '100243', name: 'Priya Raghunathan',  savings: 15230.10, status: 'frozen' },
  { id: '100244', name: 'Bennett Kowalczyk',  savings:    63.25, status: 'active' },
  { id: '100245', name: 'Aiko Nakamura',      savings:  8901.75, status: 'active' },
  { id: '100246', name: 'Rafael Ibarra',      savings:     0.00, status: 'frozen' }
];

export const sessions = new Map();
export const subAccounts = new Map();

let seq = 1;

export function findMember(id) {
  return members.find((m) => m.id === String(id));
}

export function searchMembers(q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [];
  return members.filter(
    (m) => m.id === needle || m.name.toLowerCase().includes(needle)
  );
}

export function createSubAccount(memberId, type, deposit) {
  const number = 'SA-' + String(40000000 + seq++);
  const record = {
    number,
    memberId,
    type,
    deposit,
    openedAt: new Date().toISOString()
  };
  subAccounts.set(number, record);
  return record;
}
