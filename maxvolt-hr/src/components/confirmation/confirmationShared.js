export const STATUS = [
  ['pending_hr', 'Pending HR Initiation'], ['pending_manager', 'Pending Manager Assessment'], ['confirmed', 'Confirmed'], ['on_hold', 'On Hold'], ['rejected', 'Rejected'],
];
export const STATUS_STYLE = {
  pending_hr: 'bg-gray-100 text-gray-700', pending_manager: 'bg-blue-100 text-blue-800', confirmed: 'bg-green-100 text-green-800',
  on_hold: 'bg-orange-100 text-orange-800', rejected: 'bg-red-100 text-red-800',
};
// the keys match backend/utils/confirmationRules.js CRITERIA
export const CRITERIA = [
  ['work_quality', 'Work quality'], ['productivity', 'Productivity & target achievement'], ['technical_competence', 'Technical competence'], ['communication', 'Communication'],
  ['teamwork', 'Teamwork'], ['discipline', 'Conduct & discipline'], ['learning_ability', 'Learning ability'], ['attendance', 'Attendance & punctuality'],
];
