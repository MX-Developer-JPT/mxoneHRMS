import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Upload, FileText, User, Phone, AlertCircle, Shield } from 'lucide-react';
import MobileSelect from '@/components/MobileSelect';
import { toast } from 'sonner';

const MANDATORY_DOCS = [
  { key: 'aadhar', label: 'Aadhaar Card', type: 'aadhar' },
  { key: 'pan', label: 'PAN Card', type: 'pan' },
  { key: 'marksheet_10', label: '10th Marksheet', type: 'educational' },
  { key: 'marksheet_12', label: '12th Marksheet', type: 'educational' },
];

const OPTIONAL_DOCS = [
  { key: 'graduation', label: 'Graduation Certificate', type: 'educational' },
  { key: 'postgrad', label: 'Post Graduation / Diploma', type: 'educational' },
  { key: 'offer_letter', label: 'Previous Offer Letter', type: 'offer_letter' },
  { key: 'experience_letter', label: 'Experience Letter', type: 'experience_letter' },
  { key: 'prev_payslips', label: 'Previous Payslips', type: 'other' },
];

const INSURANCE_TYPES = [
  'Health Insurance', 'Life Insurance', 'Term Insurance', 'Group Mediclaim', 'Personal Accident', 'Other'
];

export default function OnboardingForm() {
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(0); // 0 = name entry gate, 1+ = form steps
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [rejectionReason, setRejectionReason] = useState(null);

  const [personalInfo, setPersonalInfo] = useState({
    first_name: '', middle_name: '', last_name: '',
    phone: '', date_of_birth: '', address: '',
    gender: '', father_spouse_name: '',
    personal_email: '', blood_group: '',
    is_esi_applicable: false,
  });
  const [emergencyContact, setEmergencyContact] = useState({ name: '', relationship: '', phone: '', address: '' });
  const [bankDetails, setBankDetails] = useState({ account_number: '', ifsc_code: '', bank_name: '', branch: '' });
  const [aadharNumber, setAadharNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [uanNumber, setUanNumber] = useState('');
  const [pfAccountNumber, setPfAccountNumber] = useState('');
  const [pfNominee, setPfNominee] = useState({ name: '', relationship: '', date_of_birth: '', share_percentage: 100 });
  const [hasInsurance, setHasInsurance] = useState(false);
  const [insurancePolicies, setInsurancePolicies] = useState([]);
  const [policyFiles, setPolicyFiles] = useState([]);
  const [esiNumber, setEsiNumber] = useState('');
  const [healthReportFile, setHealthReportFile] = useState(null);
  const [nomineePanFile, setNomineePanFile] = useState(null);
  const [nomineeAadharFile, setNomineeAadharFile] = useState(null);

  const emptyPolicy = () => ({ insurance_type: '', insurer_name: '', policy_number: '', sum_insured: '', validity_date: '', nominee_name: '', nominee_relationship: '', nominee_date_of_birth: '' });

  const addPolicy = () => {
    setInsurancePolicies(p => [...p, emptyPolicy()]);
    setPolicyFiles(f => [...f, null]);
  };

  const removePolicy = (i) => {
    setInsurancePolicies(p => p.filter((_, idx) => idx !== i));
    setPolicyFiles(f => f.filter((_, idx) => idx !== i));
  };

  const updatePolicy = (i, field, value) => {
    setInsurancePolicies(p => p.map((pol, idx) => idx === i ? { ...pol, [field]: value } : pol));
  };

  const updatePolicyFile = (i, file) => {
    setPolicyFiles(f => f.map((ff, idx) => idx === i ? file : ff));
  };
  const [mandatoryFiles, setMandatoryFiles] = useState({});
  const [optionalFiles, setOptionalFiles] = useState({});

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);

    // Determine if name looks like an email prefix (no spaces, or contains dots/underscores)
    const existingName = currentUser.full_name || '';
    const nameIsReal = existingName.trim().includes(' ') && !existingName.includes('@');
    if (nameIsReal) {
      // Pre-fill name fields and skip step 0
      const parts = existingName.trim().split(' ');
      setPersonalInfo(prev => ({
        ...prev,
        first_name: parts[0] || '',
        middle_name: parts.length === 3 ? parts[1] : '',
        last_name: parts.length >= 2 ? parts[parts.length - 1] : '',
      }));
      setStep(1);
    } else {
      setStep(0); // Show name entry first
    }

    const empRecords = await base44.entities.Employee.filter({ user_id: currentUser.id });
    if (empRecords.length > 0 && empRecords[0].display_name && empRecords[0].display_name.includes(' ') && !nameIsReal) {
      // Employee record has a real name — pre-fill it and skip step 0
      const dn = empRecords[0].display_name.trim().split(' ');
      setPersonalInfo(prev => ({
        ...prev,
        first_name: dn[0] || '',
        middle_name: dn.length === 3 ? dn[1] : '',
        last_name: dn.length >= 2 ? dn[dn.length - 1] : '',
      }));
      setStep(1);
    }
    if (empRecords.length > 0 && empRecords[0].onboarding_submitted) {
      setAlreadySubmitted(true);
      if (empRecords[0].onboarding_rejection_reason) {
        setRejectionReason(empRecords[0].onboarding_rejection_reason);
        setAlreadySubmitted(false);
        const emp = empRecords[0];
        if (emp.phone) setPersonalInfo(prev => ({ ...prev, phone: emp.phone }));
        if (emp.gender) setPersonalInfo(prev => ({ ...prev, gender: emp.gender }));
        if (emp.father_spouse_name) setPersonalInfo(prev => ({ ...prev, father_spouse_name: emp.father_spouse_name }));
        if (emp.personal_email) setPersonalInfo(prev => ({ ...prev, personal_email: emp.personal_email }));
        if (emp.blood_group) setPersonalInfo(prev => ({ ...prev, blood_group: emp.blood_group }));
        if (emp.is_esi_applicable !== undefined) setPersonalInfo(prev => ({ ...prev, is_esi_applicable: emp.is_esi_applicable }));
        if (emp.emergency_contact) setEmergencyContact(emp.emergency_contact);
        if (emp.bank_account) setBankDetails(emp.bank_account);
        if (emp.aadhar_number) setAadharNumber(emp.aadhar_number);
        if (emp.pan_number) setPanNumber(emp.pan_number);
        if (emp.uan_number) setUanNumber(emp.uan_number);
        if (emp.pf_account_number) setPfAccountNumber(emp.pf_account_number);
        if (emp.pf_nominee) setPfNominee(emp.pf_nominee);
        if (emp.esi_number) setEsiNumber(emp.esi_number);
        if (emp.insurance_policies && emp.insurance_policies.length > 0) {
          setHasInsurance(true);
          setInsurancePolicies(emp.insurance_policies);
          setPolicyFiles(emp.insurance_policies.map(() => null));
        } else if (emp.insurance?.has_insurance) {
          // migrate legacy single insurance
          setHasInsurance(true);
          const { has_insurance, ...rest } = emp.insurance;
          setInsurancePolicies([rest]);
          setPolicyFiles([null]);
        }
      }
    }
    setLoading(false);
  };

  const isInsuranceValid = () => {
    if (!hasInsurance) return true;
    if (insurancePolicies.length === 0) return false;
    return insurancePolicies.every((p, i) =>
      p.insurance_type && p.insurer_name && p.sum_insured && p.validity_date && p.nominee_name && p.nominee_relationship && (policyFiles[i] || p.card_url)
    );
  };

  const allMandatoryFilled = () => {
    const esiValid = !personalInfo.is_esi_applicable || esiNumber;
    return personalInfo.first_name && personalInfo.phone && personalInfo.date_of_birth &&
      personalInfo.blood_group &&
      emergencyContact.name && emergencyContact.phone &&
      bankDetails.account_number && bankDetails.ifsc_code && bankDetails.bank_name &&
      aadharNumber && panNumber &&
      isInsuranceValid() && esiValid &&
      MANDATORY_DOCS.every(d => mandatoryFiles[d.key]);
  };

  const handleSubmit = async () => {
    if (!allMandatoryFilled()) {
      toast.error('Please fill all mandatory fields and upload all required documents');
      return;
    }

    setSubmitting(true);
    try {

    await base44.functions.invoke('updateUserName', {
      first_name: personalInfo.first_name,
      middle_name: personalInfo.middle_name,
      last_name: personalInfo.last_name,
    });

    let uploadedPolicies = [];
    for (let i = 0; i < insurancePolicies.length; i++) {
      const pol = { ...insurancePolicies[i] };
      if (policyFiles[i]) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: policyFiles[i] });
        pol.card_url = file_url;
      }
      uploadedPolicies.push(pol);
    }

    let healthReportUrl = null;
    if (healthReportFile) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: healthReportFile });
      healthReportUrl = file_url;
    }
    let nomineePanUrl = null;
    if (nomineePanFile) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: nomineePanFile });
      nomineePanUrl = file_url;
    }
    let nomineeAadharUrl = null;
    if (nomineeAadharFile) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: nomineeAadharFile });
      nomineeAadharUrl = file_url;
    }

    const empRecords = await base44.entities.Employee.filter({ user_id: user.id });
    const fullName = [personalInfo.first_name, personalInfo.middle_name, personalInfo.last_name].filter(Boolean).join(' ');

    const empData = {
      user_id: user.id,
      display_name: fullName,
      employee_code: user.email.split('@')[0].toUpperCase(),
      department: 'unassigned',
      designation: 'New Joiner',
      date_of_joining: new Date().toISOString().split('T')[0],
      phone: personalInfo.phone,
      personal_email: personalInfo.personal_email,
      blood_group: personalInfo.blood_group,
      is_esi_applicable: personalInfo.is_esi_applicable,
      esi_number: personalInfo.is_esi_applicable ? esiNumber : null,
      health_report_url: healthReportUrl,
      insurance_policies: uploadedPolicies,
      nominee_pan_url: nomineePanUrl,
      nominee_aadhar_url: nomineeAadharUrl,
      date_of_birth: personalInfo.date_of_birth,
      address: personalInfo.address,
      gender: personalInfo.gender,
      father_spouse_name: personalInfo.father_spouse_name,
      emergency_contact: emergencyContact,
      bank_account: bankDetails,
      aadhar_number: aadharNumber,
      pan_number: panNumber,
      uan_number: uanNumber,
      pf_account_number: pfAccountNumber,
      pf_nominee: pfNominee,
      onboarding_submitted: true,
      onboarding_rejection_reason: null,
    };

    let empId;
    if (empRecords.length > 0) {
      await base44.entities.Employee.update(empRecords[0].id, empData);
      empId = empRecords[0].id;
    } else {
      const newEmp = await base44.entities.Employee.create(empData);
      empId = newEmp.id;
    }

    for (const doc of MANDATORY_DOCS) {
      const file = mandatoryFiles[doc.key];
      if (file) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        await base44.entities.Document.create({
          user_id: user.id, document_type: doc.type, document_name: doc.label,
          document_url: file_url, uploaded_by: user.id, status: 'pending_verification',
        });
      }
    }

    for (const doc of OPTIONAL_DOCS) {
      const file = optionalFiles[doc.key];
      if (file) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        await base44.entities.Document.create({
          user_id: user.id, document_type: doc.type, document_name: doc.label,
          document_url: file_url, uploaded_by: user.id, status: 'pending_verification',
        });
      }
    }

    // Mark as submitted BEFORE sending email so confirmation always shows
    setAlreadySubmitted(true);
    toast.success('Onboarding documents submitted! HR will review and approve soon.');

    // Send notification email (non-blocking — don't let email failure block confirmation)
    base44.integrations.Core.SendEmail({
      to: 'hr@maxvoltenergy.com',
      subject: `New Onboarding Submission: ${personalInfo.first_name} ${personalInfo.last_name}`,
      body: `A new employee has completed their onboarding document submission.\n\nName: ${[personalInfo.first_name, personalInfo.middle_name, personalInfo.last_name].filter(Boolean).join(' ')}\nEmail: ${user.email}\n\nPlease log in to the HR portal to review and approve.`,
    }).catch(e => console.warn('Email notification failed:', e));

    } catch (err) {
      console.error('Onboarding submit error:', err);
      toast.error(`Submission failed: ${err.message || 'Please try again.'}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  if (alreadySubmitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Submission Received!</h2>
            <p className="text-gray-600 mb-4">Your onboarding documents have been submitted. HR will review and approve shortly.</p>
            <Badge className="bg-yellow-100 text-yellow-800">Pending HR Approval</Badge>
            <div className="mt-6">
              <Button variant="outline" onClick={() => base44.auth.logout()}>Logout</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleNameSubmit = async () => {
    if (!personalInfo.first_name.trim() || !personalInfo.last_name.trim()) return;
    const fullName = [personalInfo.first_name.trim(), personalInfo.middle_name.trim(), personalInfo.last_name.trim()].filter(Boolean).join(' ');
    try {
      await base44.functions.invoke('updateUserName', {
        first_name: personalInfo.first_name.trim(),
        middle_name: personalInfo.middle_name.trim(),
        last_name: personalInfo.last_name.trim(),
      });
      // Also update the employee display_name immediately
      const empRecords = await base44.entities.Employee.filter({ user_id: user.id });
      if (empRecords.length > 0) {
        await base44.entities.Employee.update(empRecords[0].id, { display_name: fullName });
      }
    } catch (e) {
      console.warn('Name update error:', e);
    }
    setStep(1);
  };

  const STEPS = [
    { n: 1, label: 'Personal Info' },
    { n: 2, label: 'Bank & IDs' },
    { n: 3, label: 'Insurance' },
    { n: 4, label: 'Documents' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-white rounded-2xl px-5 py-2.5 shadow-sm mb-4 border border-slate-100">
            <img src="/maxvolt-logo.jpg?v=3" alt="Maxvolt Energy" className="h-12 object-contain" />
          </div>
          <h1 className="text-2xl font-bold">Employee Onboarding</h1>
          <p className="text-gray-600">Complete your profile to get started</p>
        </div>

        {rejectionReason && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800">Your submission was rejected</p>
              <p className="text-red-700 text-sm mt-1">Reason: {rejectionReason}</p>
              <p className="text-red-600 text-sm mt-1">Please correct the issues and re-submit.</p>
            </div>
          </div>
        )}

        {/* Step 0: Name Entry */}
        {step === 0 && (
          <Card className="max-w-md mx-auto">
            <CardHeader>
              <CardTitle className="flex gap-2 items-center"><User className="w-5 h-5" />What's your name?</CardTitle>
              <p className="text-sm text-gray-500 mt-1">Please enter your full name as it should appear on official documents.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>First Name <span className="text-red-500">*</span></Label>
                <Input
                  autoFocus
                  value={personalInfo.first_name}
                  onChange={e => setPersonalInfo(p => ({ ...p, first_name: e.target.value }))}
                  placeholder="e.g. Rajesh"
                />
              </div>
              <div>
                <Label>Middle Name</Label>
                <Input
                  value={personalInfo.middle_name}
                  onChange={e => setPersonalInfo(p => ({ ...p, middle_name: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label>Last Name <span className="text-red-500">*</span></Label>
                <Input
                  value={personalInfo.last_name}
                  onChange={e => setPersonalInfo(p => ({ ...p, last_name: e.target.value }))}
                  placeholder="e.g. Kumar"
                  onKeyDown={e => e.key === 'Enter' && handleNameSubmit()}
                />
              </div>
              {personalInfo.first_name && personalInfo.last_name && (
                <p className="text-xs text-gray-400">Your name will appear as: <strong>{[personalInfo.first_name, personalInfo.middle_name, personalInfo.last_name].filter(Boolean).join(' ')}</strong></p>
              )}
              <Button
                className="w-full"
                onClick={handleNameSubmit}
                disabled={!personalInfo.first_name.trim() || !personalInfo.last_name.trim()}
              >
                Continue →
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step indicator */}
        {step > 0 && (
        <div className="flex items-center justify-center gap-2 mb-8 flex-wrap">
          {STEPS.map((s, i) => (
            <div key={s.n} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                ${step > s.n ? 'bg-green-500 text-white' : step === s.n ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                {step > s.n ? '✓' : s.n}
              </div>
              <span className={`text-sm hidden md:block ${step === s.n ? 'font-semibold' : 'text-gray-500'}`}>{s.label}</span>
              {i < STEPS.length - 1 && <div className="w-6 h-0.5 bg-gray-300" />}
            </div>
          ))}
        </div>
        )}

        {/* Step 1: Personal Info */}
        {step === 1 && (
          <Card>
            <CardHeader><CardTitle className="flex gap-2"><User className="w-5 h-5" />Personal Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <Label>First Name *</Label>
                  <Input value={personalInfo.first_name} onChange={e => setPersonalInfo(p => ({ ...p, first_name: e.target.value }))} placeholder="First Name" />
                </div>
                <div>
                  <Label>Middle Name</Label>
                  <Input value={personalInfo.middle_name} onChange={e => setPersonalInfo(p => ({ ...p, middle_name: e.target.value }))} placeholder="Middle Name" />
                </div>
                <div>
                  <Label>Last Name</Label>
                  <Input value={personalInfo.last_name} onChange={e => setPersonalInfo(p => ({ ...p, last_name: e.target.value }))} placeholder="Last Name" />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Phone Number *</Label>
                  <Input value={personalInfo.phone} onChange={e => setPersonalInfo(p => ({ ...p, phone: e.target.value }))} placeholder="+91 9876543210" />
                </div>
                <div>
                  <Label>Personal Email</Label>
                  <Input type="email" value={personalInfo.personal_email} onChange={e => setPersonalInfo(p => ({ ...p, personal_email: e.target.value }))} placeholder="yourname@gmail.com" />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Date of Birth *</Label>
                  <Input type="date" value={personalInfo.date_of_birth} onChange={e => setPersonalInfo(p => ({ ...p, date_of_birth: e.target.value }))} />
                </div>
                <div>
                  <Label>Blood Group *</Label>
                  <MobileSelect
                    value={personalInfo.blood_group}
                    onValueChange={v => setPersonalInfo(p => ({ ...p, blood_group: v }))}
                    placeholder="Select Blood Group"
                    label="Select Blood Group"
                    options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => ({ value: bg, label: bg }))}
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Gender *</Label>
                  <MobileSelect
                    value={personalInfo.gender}
                    onValueChange={v => setPersonalInfo(p => ({ ...p, gender: v }))}
                    placeholder="Select Gender"
                    label="Select Gender"
                    options={[
                      { value: 'male', label: 'Male' },
                      { value: 'female', label: 'Female' },
                      { value: 'other', label: 'Other' },
                    ]}
                  />
                </div>
                <div>
                  <Label>Father / Spouse Name</Label>
                  <Input value={personalInfo.father_spouse_name} onChange={e => setPersonalInfo(p => ({ ...p, father_spouse_name: e.target.value }))} placeholder="Father or Spouse name" />
                </div>
              </div>
              <div>
                <Label>Residential Address</Label>
                <Input value={personalInfo.address} onChange={e => setPersonalInfo(p => ({ ...p, address: e.target.value }))} placeholder="Full address" />
              </div>

              {/* ESI */}
              <div className="border rounded-lg p-4 bg-yellow-50 border-yellow-200">
                <Label className="font-semibold">ESI (Employee State Insurance) *</Label>
                <p className="text-xs text-gray-500 mb-3 mt-1">ESI is applicable for employees earning up to ₹21,000/month. Please select accordingly.</p>
                <div className="flex gap-4 mb-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="esi" checked={personalInfo.is_esi_applicable === true}
                      onChange={() => setPersonalInfo(p => ({ ...p, is_esi_applicable: true }))} />
                    <span className="text-sm font-medium">Yes, I fall under ESI category</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="esi" checked={personalInfo.is_esi_applicable === false}
                      onChange={() => setPersonalInfo(p => ({ ...p, is_esi_applicable: false }))} />
                    <span className="text-sm font-medium">No, I do not fall under ESI</span>
                  </label>
                </div>
                {personalInfo.is_esi_applicable && (
                  <div>
                    <Label>ESI Number <span className="text-red-500">*</span></Label>
                    <Input
                      value={esiNumber}
                      onChange={e => setEsiNumber(e.target.value)}
                      placeholder="Enter your ESI number"
                      className="mt-1"
                    />
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2"><Phone className="w-4 h-4" />Emergency Contact *</h3>
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <Label>Contact Name *</Label>
                    <Input value={emergencyContact.name} onChange={e => setEmergencyContact(p => ({ ...p, name: e.target.value }))} placeholder="Full Name" />
                  </div>
                  <div>
                    <Label>Relationship</Label>
                    <Input value={emergencyContact.relationship} onChange={e => setEmergencyContact(p => ({ ...p, relationship: e.target.value }))} placeholder="e.g. Spouse, Parent" />
                  </div>
                  <div>
                    <Label>Phone *</Label>
                    <Input value={emergencyContact.phone} onChange={e => setEmergencyContact(p => ({ ...p, phone: e.target.value }))} placeholder="+91 9876543210" />
                  </div>
                </div>
                <div className="mt-3">
                  <Label>Emergency Contact Address</Label>
                  <Input value={emergencyContact.address} onChange={e => setEmergencyContact(p => ({ ...p, address: e.target.value }))} placeholder="Emergency contact's address" />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => setStep(2)}
                  disabled={!personalInfo.first_name || !personalInfo.phone || !personalInfo.date_of_birth || !personalInfo.blood_group || !personalInfo.gender || !emergencyContact.name || !emergencyContact.phone}
                >
                  Next: Bank & IDs →
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Bank & IDs */}
        {step === 2 && (
          <Card>
            <CardHeader><CardTitle>Bank Details, Identity & PF Nominee</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Aadhaar Number *</Label>
                  <Input value={aadharNumber} onChange={e => setAadharNumber(e.target.value)} placeholder="XXXX XXXX XXXX" maxLength={12} />
                </div>
                <div>
                  <Label>PAN Number *</Label>
                  <Input value={panNumber} onChange={e => setPanNumber(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>UAN Number</Label>
                  <Input value={uanNumber} onChange={e => setUanNumber(e.target.value)} placeholder="UAN Number (if available)" />
                </div>
                <div>
                  <Label>PF Account Number</Label>
                  <Input value={pfAccountNumber} onChange={e => setPfAccountNumber(e.target.value)} placeholder="PF Account Number (if available)" />
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3">Bank Account Details *</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Account Number *</Label>
                    <Input value={bankDetails.account_number} onChange={e => setBankDetails(p => ({ ...p, account_number: e.target.value }))} placeholder="Account number" />
                  </div>
                  <div>
                    <Label>IFSC Code *</Label>
                    <Input value={bankDetails.ifsc_code} onChange={e => setBankDetails(p => ({ ...p, ifsc_code: e.target.value.toUpperCase() }))} placeholder="SBIN0001234" />
                  </div>
                  <div>
                    <Label>Bank Name *</Label>
                    <Input value={bankDetails.bank_name} onChange={e => setBankDetails(p => ({ ...p, bank_name: e.target.value }))} placeholder="State Bank of India" />
                  </div>
                  <div>
                    <Label>Branch</Label>
                    <Input value={bankDetails.branch} onChange={e => setBankDetails(p => ({ ...p, branch: e.target.value }))} placeholder="Branch name" />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold mb-1">PF Nominee Details</h3>
                <p className="text-xs text-gray-500 mb-3">Nominee for Provident Fund account (required if you have UAN/PF)</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Nominee Name</Label>
                    <Input value={pfNominee.name} onChange={e => setPfNominee(p => ({ ...p, name: e.target.value }))} placeholder="Full name" />
                  </div>
                  <div>
                    <Label>Relationship</Label>
                    <Input value={pfNominee.relationship} onChange={e => setPfNominee(p => ({ ...p, relationship: e.target.value }))} placeholder="e.g. Spouse, Father" />
                  </div>
                  <div>
                    <Label>Date of Birth</Label>
                    <Input type="date" value={pfNominee.date_of_birth} onChange={e => setPfNominee(p => ({ ...p, date_of_birth: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Share Percentage</Label>
                    <Input type="number" min={1} max={100} value={pfNominee.share_percentage} onChange={e => setPfNominee(p => ({ ...p, share_percentage: e.target.value }))} placeholder="100" />
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={!aadharNumber || !panNumber || !bankDetails.account_number || !bankDetails.ifsc_code || !bankDetails.bank_name}
                >
                  Next: Insurance →
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Insurance Declaration */}
        {step === 3 && (
          <Card>
            <CardHeader><CardTitle className="flex gap-2"><Shield className="w-5 h-5" />Insurance Declaration</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                <Label className="font-semibold">Do you have any active insurance policies? *</Label>
                <div className="flex gap-6 mt-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="hasInsurance" checked={hasInsurance === true}
                      onChange={() => { setHasInsurance(true); if (insurancePolicies.length === 0) addPolicy(); }} />
                    <span className="text-sm font-medium">Yes, I have insurance</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="hasInsurance" checked={hasInsurance === false}
                      onChange={() => { setHasInsurance(false); setInsurancePolicies([]); setPolicyFiles([]); }} />
                    <span className="text-sm font-medium">No, I don't have insurance</span>
                  </label>
                </div>
              </div>

              {hasInsurance && insurancePolicies.map((pol, i) => (
                <div key={i} className="border rounded-lg p-4 space-y-4 relative">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-gray-700">Policy {i + 1}</h3>
                    {insurancePolicies.length > 1 && (
                      <Button variant="ghost" size="sm" className="text-red-500 h-7 px-2" onClick={() => removePolicy(i)}>Remove</Button>
                    )}
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label>Insurance Type *</Label>
                      <MobileSelect
                        value={pol.insurance_type}
                        onValueChange={v => updatePolicy(i, 'insurance_type', v)}
                        placeholder="Select type"
                        label="Select Insurance Type"
                        options={INSURANCE_TYPES.map(t => ({ value: t, label: t }))}
                      />
                    </div>
                    <div>
                      <Label>Insurer / Company Name *</Label>
                      <Input value={pol.insurer_name} onChange={e => updatePolicy(i, 'insurer_name', e.target.value)} placeholder="e.g. LIC, Star Health" />
                    </div>
                    <div>
                      <Label>Policy Number</Label>
                      <Input value={pol.policy_number} onChange={e => updatePolicy(i, 'policy_number', e.target.value)} placeholder="Policy number" />
                    </div>
                    <div>
                      <Label>Sum Insured (₹) *</Label>
                      <Input type="number" value={pol.sum_insured} onChange={e => updatePolicy(i, 'sum_insured', e.target.value)} placeholder="e.g. 500000" />
                    </div>
                    <div>
                      <Label>Policy Validity Date *</Label>
                      <Input type="date" value={pol.validity_date} onChange={e => updatePolicy(i, 'validity_date', e.target.value)} />
                    </div>
                  </div>
                  <div className="border-t pt-3">
                    <p className="text-xs font-semibold text-gray-600 mb-3">Nominee Details *</p>
                    <div className="grid md:grid-cols-3 gap-4">
                      <div>
                        <Label>Nominee Name *</Label>
                        <Input value={pol.nominee_name} onChange={e => updatePolicy(i, 'nominee_name', e.target.value)} placeholder="Full name" />
                      </div>
                      <div>
                        <Label>Relationship *</Label>
                        <Input value={pol.nominee_relationship} onChange={e => updatePolicy(i, 'nominee_relationship', e.target.value)} placeholder="e.g. Spouse" />
                      </div>
                      <div>
                        <Label>Nominee DOB</Label>
                        <Input type="date" value={pol.nominee_date_of_birth} onChange={e => updatePolicy(i, 'nominee_date_of_birth', e.target.value)} />
                      </div>
                    </div>
                  </div>
                  <div className="border-t pt-3">
                    <p className="text-xs font-semibold text-gray-600 mb-2">Policy Document <span className="text-red-500">*</span></p>
                    <div className="flex items-center gap-4 p-3 border rounded-lg bg-gray-50">
                      <div className="flex-1">
                        {policyFiles[i] ? (
                          <p className="text-xs text-green-600">✓ {policyFiles[i].name}</p>
                        ) : pol.card_url ? (
                          <p className="text-xs text-green-600">✓ Previously uploaded</p>
                        ) : (
                          <p className="text-sm text-gray-500">No file uploaded</p>
                        )}
                      </div>
                      <label className="cursor-pointer">
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                          onChange={e => { if (e.target.files[0]) updatePolicyFile(i, e.target.files[0]); }} />
                        <Button variant="outline" size="sm" asChild>
                          <span><Upload className="w-4 h-4 mr-1" />{policyFiles[i] || pol.card_url ? 'Change' : 'Upload'}</span>
                        </Button>
                      </label>
                    </div>
                  </div>
                </div>
              ))}

              {hasInsurance && (
                <Button variant="outline" className="w-full" onClick={addPolicy}>+ Add Another Policy</Button>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
                <Button onClick={() => setStep(4)} disabled={!isInsuranceValid()}>
                  Next: Documents →
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Documents */}
        {step === 4 && (
          <Card>
            <CardHeader><CardTitle className="flex gap-2"><FileText className="w-5 h-5" />Upload Documents</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="font-semibold text-red-700 mb-3">Mandatory Documents</h3>
                <div className="space-y-3">
                  {MANDATORY_DOCS.map(doc => (
                    <div key={doc.key} className="flex items-center gap-4 p-3 border rounded-lg bg-gray-50">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{doc.label} <span className="text-red-500">*</span></p>
                        {mandatoryFiles[doc.key] && (
                          <p className="text-xs text-green-600 mt-1">✓ {mandatoryFiles[doc.key].name}</p>
                        )}
                      </div>
                      <label className="cursor-pointer">
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                          onChange={e => { if (e.target.files[0]) setMandatoryFiles(p => ({ ...p, [doc.key]: e.target.files[0] })); }} />
                        <Button variant="outline" size="sm" asChild>
                          <span><Upload className="w-4 h-4 mr-1" />{mandatoryFiles[doc.key] ? 'Change' : 'Upload'}</span>
                        </Button>
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Health Report */}
              <div>
                <h3 className="font-semibold text-gray-700 mb-1">Health Report</h3>
                <p className="text-xs text-gray-500 mb-3">Upload your latest health report / medical fitness certificate (optional).</p>
                <div className="flex items-center gap-4 p-3 border rounded-lg bg-gray-50">
                  <div className="flex-1">
                    {healthReportFile ? (
                      <p className="text-xs text-green-600">✓ {healthReportFile.name}</p>
                    ) : (
                      <p className="text-sm text-gray-500">No file uploaded</p>
                    )}
                  </div>
                  <label className="cursor-pointer">
                    <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                      onChange={e => { if (e.target.files[0]) setHealthReportFile(e.target.files[0]); }} />
                    <Button variant="outline" size="sm" asChild>
                      <span><Upload className="w-4 h-4 mr-1" />{healthReportFile ? 'Change' : 'Upload'}</span>
                    </Button>
                  </label>
                </div>
              </div>

              {/* Nominee Documents */}
              <div>
                <h3 className="font-semibold text-gray-700 mb-1">Nominee Documents</h3>
                <p className="text-xs text-gray-500 mb-3">Upload PAN and/or Aadhaar of your PF/insurance nominee (optional but recommended).</p>
                <div className="space-y-3">
                  {[
                    { key: 'nominee_pan', label: 'Nominee PAN Card', file: nomineePanFile, setFile: setNomineePanFile },
                    { key: 'nominee_aadhar', label: 'Nominee Aadhaar Card', file: nomineeAadharFile, setFile: setNomineeAadharFile },
                  ].map(doc => (
                    <div key={doc.key} className="flex items-center gap-4 p-3 border rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{doc.label}</p>
                        {doc.file && <p className="text-xs text-green-600 mt-1">✓ {doc.file.name}</p>}
                      </div>
                      <label className="cursor-pointer">
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                          onChange={e => { if (e.target.files[0]) doc.setFile(e.target.files[0]); }} />
                        <Button variant="outline" size="sm" asChild>
                          <span><Upload className="w-4 h-4 mr-1" />{doc.file ? 'Change' : 'Upload'}</span>
                        </Button>
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-600 mb-3">Optional Documents</h3>
                <div className="space-y-3">
                  {OPTIONAL_DOCS.map(doc => (
                    <div key={doc.key} className="flex items-center gap-4 p-3 border rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{doc.label}</p>
                        {optionalFiles[doc.key] && (
                          <p className="text-xs text-green-600 mt-1">✓ {optionalFiles[doc.key].name}</p>
                        )}
                      </div>
                      <label className="cursor-pointer">
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                          onChange={e => { if (e.target.files[0]) setOptionalFiles(p => ({ ...p, [doc.key]: e.target.files[0] })); }} />
                        <Button variant="outline" size="sm" asChild>
                          <span><Upload className="w-4 h-4 mr-1" />{optionalFiles[doc.key] ? 'Change' : 'Upload'}</span>
                        </Button>
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
                <p className="font-medium mb-1">Before submitting, please ensure:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>All mandatory documents are uploaded (PDF, JPG, or PNG)</li>
                  <li>Bank account details are accurate</li>
                  <li>Aadhaar and PAN numbers are correct</li>
                  {hasInsurance && <li>Insurance policy documents have been uploaded</li>}
                </ul>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(3)}>← Back</Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !allMandatoryFilled()}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {submitting ? 'Submitting...' : '✓ Submit for HR Review'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 text-center">
          <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => base44.auth.logout()}>
            Logout
          </Button>
        </div>
      </div>
    </div>
  );
}