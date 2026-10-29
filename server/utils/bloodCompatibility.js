/**
 * LifeLink Centralized Blood Compatibility Engine
 * Standard Medical ABO / Rh blood compatibility rules.
 */

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Mapping: Given a recipient's blood group, which donor blood groups can they receive blood from?
const COMPATIBLE_DONORS_FOR_RECIPIENT = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-']
};

// Mapping: Given a donor's blood group, which recipients can they donate to?
const COMPATIBLE_RECIPIENTS_FOR_DONOR = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O+', 'A+', 'B+', 'AB+'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'AB+'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+']
};

/**
 * Check if donor's blood group is compatible with recipient's required blood group
 * @param {string} donorGroup - e.g. "O-"
 * @param {string} recipientGroup - e.g. "B+"
 * @returns {boolean}
 */
function isBloodCompatible(donorGroup, recipientGroup) {
  if (!BLOOD_GROUPS.includes(donorGroup) || !BLOOD_GROUPS.includes(recipientGroup)) {
    return false;
  }
  const eligibleDonors = COMPATIBLE_DONORS_FOR_RECIPIENT[recipientGroup] || [];
  return eligibleDonors.includes(donorGroup);
}

/**
 * Get all donor blood groups that can donate to the given recipient blood group
 * @param {string} recipientGroup - e.g. "A+"
 * @returns {string[]} array of compatible donor blood groups
 */
function getCompatibleDonorBloodGroups(recipientGroup) {
  if (!BLOOD_GROUPS.includes(recipientGroup)) {
    return [];
  }
  return COMPATIBLE_DONORS_FOR_RECIPIENT[recipientGroup] || [];
}

/**
 * Get all recipient blood groups that the given donor can donate to
 * @param {string} donorGroup - e.g. "O-"
 * @returns {string[]} array of recipient blood groups
 */
function getCompatibleRecipientBloodGroups(donorGroup) {
  if (!BLOOD_GROUPS.includes(donorGroup)) {
    return [];
  }
  return COMPATIBLE_RECIPIENTS_FOR_DONOR[donorGroup] || [];
}

module.exports = {
  BLOOD_GROUPS,
  COMPATIBLE_DONORS_FOR_RECIPIENT,
  COMPATIBLE_RECIPIENTS_FOR_DONOR,
  isBloodCompatible,
  getCompatibleDonorBloodGroups,
  getCompatibleRecipientBloodGroups
};
