/**
 * LifeLink Digital Certificate of Appreciation Generator & Viewer
 */

async function viewCertificate(donationId) {
  try {
    const data = await api.get(`/donations/certificate/${donationId}`);
    const cert = data.donation;

    const donorName = document.getElementById('certDonorName');
    const bloodGroup = document.getElementById('certBloodGroup');
    const hospital = document.getElementById('certHospital');
    const certDate = document.getElementById('certDate');
    const certId = document.getElementById('certId');
    const verifyCode = document.getElementById('certVerificationCode');

    if (donorName) donorName.textContent = (cert.donorId?.name || 'GENEROUS DONOR').toUpperCase();
    if (bloodGroup) bloodGroup.textContent = cert.bloodGroup;
    if (hospital) hospital.textContent = cert.hospitalName;
    if (certDate) {
      certDate.textContent = new Date(cert.donationDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    }
    if (certId) certId.textContent = cert.certificateId;
    if (verifyCode) verifyCode.textContent = `Security Verification: ${cert.verificationCode}`;

    openModal('certificateModal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function initCertificateHandlers() {
  const printBtn = document.getElementById('printCertBtn');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }
}
