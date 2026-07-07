import React from 'react';
import { ShieldCheck } from 'lucide-react';

const LAST_UPDATED = '7 July 2026';

function Section({ title, children }) {
  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold text-gray-900 mb-2">{title}</h2>
      <div className="text-sm text-gray-600 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export default function PrivacyPolicy() {
  return (
    <div
      className="min-h-dvh bg-gray-50 px-4"
      style={{
        paddingTop: 'calc(2.5rem + env(safe-area-inset-top))',
        paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))',
      }}
    >
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border p-6 md:p-10">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Privacy Policy</h1>
            <p className="text-xs text-gray-400">Maxvolt HR — Maxvolt Energy Industries Limited</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-8">Last updated: {LAST_UPDATED}</p>

        <Section title="1. Introduction">
          <p>
            Maxvolt Energy Industries Limited ("Maxvolt", "we", "us", "our") operates the Maxvolt HR
            application ("the App"), a Human Resources Management System provided for the exclusive use
            of Maxvolt employees and authorized personnel. This Privacy Policy explains what information
            the App collects, how it is used, and the choices available to you. By using the App, you
            agree to the collection and use of information in accordance with this policy.
          </p>
        </Section>

        <Section title="2. Who Can Use This App">
          <p>
            The App is an internal enterprise tool. Access is restricted to current employees, contractors,
            and authorized personnel of Maxvolt who have been issued login credentials by the HR
            department. It is not intended for use by the general public or by anyone under the age of 18.
          </p>
        </Section>

        <Section title="3. Information We Collect">
          <p>We collect the following categories of information as part of normal HRMS operation:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Account &amp; profile information:</strong> name, employee code, designation, department, email address, phone number, date of birth, date of joining, and other HR-record fields.</li>
            <li><strong>Attendance &amp; location data:</strong> check-in/check-out timestamps, and — only while attendance tracking is active and with your permission — GPS location, used to confirm attendance at a configured office/site location via geofencing. See Section 5 for details on background location use.</li>
            <li><strong>Camera &amp; photos:</strong> a selfie photograph may be captured at the moment of check-in/check-out where selfie-based attendance is enabled, to verify identity.</li>
            <li><strong>Biometric attendance device data:</strong> punch records synced from company-installed biometric attendance devices (fingerprint/face terminals), where applicable, linked to your employee record.</li>
            <li><strong>Documents &amp; records:</strong> HR letters, payroll and tax declarations, leave and expense requests, performance reviews, gate passes, and company asset assignment records that you or HR create within the App.</li>
            <li><strong>Device &amp; push notification data:</strong> a device push token used solely to deliver in-app notifications (e.g., approval updates, attendance reminders).</li>
            <li><strong>Digital signatures:</strong> a captured signature image when you digitally acknowledge a document (e.g., an asset checkout letter) within the App.</li>
          </ul>
        </Section>

        <Section title="4. How We Use Information">
          <ul className="list-disc pl-5 space-y-1">
            <li>To record and verify attendance, working hours, and leave.</li>
            <li>To process payroll, tax computations, and statutory compliance.</li>
            <li>To manage HR workflows: leave, gate passes, reimbursements, performance reviews, asset assignment, and document generation.</li>
            <li>To send you in-app and push notifications relevant to your HR requests and approvals.</li>
            <li>To maintain accurate company records and support internal audits required by law or company policy.</li>
          </ul>
          <p>We do not sell, rent, or use your personal information for advertising purposes.</p>
        </Section>

        <Section title="5. Location Data &amp; Background Geofencing">
          <p>
            With your explicit permission, the App may track your device location — including while the
            App is closed or not in active use ("background location") — solely to automatically mark
            attendance when you enter or leave a company-configured office/site location (geofencing).
            This is an optional convenience feature: you can decline location permission and continue
            marking attendance manually or via biometric device instead. Location data collected this
            way is used only for attendance purposes and is not shared with third parties or used for any
            other form of tracking. You can disable this feature at any time from within the App or from
            your device's Settings.
          </p>
        </Section>

        <Section title="6. Camera &amp; Photo Data">
          <p>
            Where selfie-based attendance is enabled, a photo is captured at the moment of check-in/out
            to confirm your identity and is stored securely against your attendance record. The App does
            not access your camera or photo library at any other time.
          </p>
        </Section>

        <Section title="7. Data Sharing With Third Parties">
          <p>
            We use a limited number of trusted service providers to operate the App. These providers
            process data strictly on our behalf and under confidentiality obligations:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Cloud hosting</strong> — to run the application servers and database.</li>
            <li><strong>Cloud file storage</strong> (Cloudflare R2 / Cloudinary) — to store uploaded documents, photos, and signature images.</li>
            <li><strong>Push notification delivery</strong> (Firebase Cloud Messaging / Web Push) — to deliver notifications to your device.</li>
            <li><strong>Email delivery</strong> — to send HR-related emails (offer letters, approvals, notifications).</li>
          </ul>
          <p>We do not share your personal data with any other third party except where required by law.</p>
        </Section>

        <Section title="8. Data Retention">
          <p>
            HR records, including attendance, payroll, and tax data, are retained for as long as required
            by applicable Indian labour, tax, and company law, and for the duration of your employment
            plus any additional period required for statutory or audit purposes. You may request deletion
            of data that is not subject to a legal retention requirement (see Section 10).
          </p>
        </Section>

        <Section title="9. Data Security">
          <p>
            We use industry-standard measures — encrypted connections (HTTPS), access-controlled
            databases, and role-based permissions within the App — to protect your information.
            Sensitive fields such as biometric identifiers, signatures, and salary details are only
            accessible to you and to authorized HR/Admin personnel.
          </p>
        </Section>

        <Section title="10. Your Rights">
          <p>
            You may request access to, correction of, or deletion of your personal data (subject to
            statutory retention requirements) by contacting HR at the email address below. You may also
            withdraw location or camera permission at any time via your device Settings, though this may
            limit automatic attendance features.
          </p>
        </Section>

        <Section title="11. Children's Privacy">
          <p>
            The App is intended solely for use by employees of legal working age and is not directed at
            children. We do not knowingly collect information from anyone under 18.
          </p>
        </Section>

        <Section title="12. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. Material changes will be communicated
            to employees via the App or via email. The "Last updated" date at the top of this page
            reflects the most recent revision.
          </p>
        </Section>

        <Section title="13. Contact Us">
          <p>
            For any questions about this Privacy Policy or your personal data, please contact:
            <br /><strong>Maxvolt Energy Industries Limited — HR Department</strong>
            <br />Email: <a href="mailto:hr@maxvoltenergy.com" className="text-indigo-600 hover:underline">hr@maxvoltenergy.com</a>
            <br />Address: E-82 Bulandshahr Road Industrial Area, Ghaziabad, Uttar Pradesh – 201009, India
          </p>
        </Section>
      </div>
    </div>
  );
}
