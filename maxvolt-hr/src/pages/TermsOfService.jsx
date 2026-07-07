import React from 'react';
import { FileSignature } from 'lucide-react';

const LAST_UPDATED = '7 July 2026';

function Section({ title, children }) {
  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold text-gray-900 mb-2">{title}</h2>
      <div className="text-sm text-gray-600 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export default function TermsOfService() {
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
            <FileSignature className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Terms of Service</h1>
            <p className="text-xs text-gray-400">Maxvolt HR — Maxvolt Energy Industries Limited</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-8">Last updated: {LAST_UPDATED}</p>

        <Section title="1. Acceptance of Terms">
          <p>
            These Terms of Service ("Terms") govern your access to and use of the Maxvolt HR application
            ("the App"), provided by Maxvolt Energy Industries Limited ("Maxvolt", "we", "us"). By logging
            in to or using the App, you agree to be bound by these Terms. If you do not agree, you must
            not use the App.
          </p>
        </Section>

        <Section title="2. Eligibility &amp; Account Access">
          <p>
            The App is an internal enterprise tool provided exclusively to current employees, contractors,
            and other personnel authorized by Maxvolt HR. Access credentials are issued by HR and are for
            your individual use only. You are responsible for keeping your login credentials confidential
            and for all activity carried out under your account.
          </p>
        </Section>

        <Section title="3. Acceptable Use">
          <p>You agree to use the App only for legitimate work-related purposes, and agree not to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Falsify attendance, location, leave, expense, or any other HR record.</li>
            <li>Share your login credentials with any other person.</li>
            <li>Attempt to access data or accounts belonging to other employees without authorization.</li>
            <li>Use the App in any way that violates applicable law or Maxvolt's internal policies.</li>
            <li>Reverse-engineer, decompile, or attempt to extract the source code of the App.</li>
          </ul>
        </Section>

        <Section title="4. Attendance, Location &amp; Biometric Data">
          <p>
            Certain features of the App — geofenced attendance, selfie-based check-in, and biometric
            device sync — require your consent to collect location, camera, or biometric attendance data
            as described in our <a href="/PrivacyPolicy" className="text-indigo-600 hover:underline">Privacy Policy</a>.
            By enabling these features, you consent to this data being used for attendance verification
            purposes. You may decline and use manual or alternative attendance methods instead where
            offered by your organization's policy.
          </p>
        </Section>

        <Section title="5. Company Property &amp; Digital Acknowledgment">
          <p>
            Where the App is used to assign, track, or acknowledge company assets (e.g., laptops,
            equipment), any digital signature or acknowledgment you provide within the App carries the
            same effect as a physical signature and confirms your receipt of, and agreement to the terms
            governing, the asset(s) described.
          </p>
        </Section>

        <Section title="6. Accuracy of Information">
          <p>
            You are responsible for ensuring that information you submit through the App (personal
            details, leave requests, expense claims, tax declarations, etc.) is true, accurate, and
            complete. Maxvolt reserves the right to verify any information submitted and to take
            appropriate action, including disciplinary action, in case of false or misleading submissions.
          </p>
        </Section>

        <Section title="7. Intellectual Property">
          <p>
            The App, including its design, code, and content, is the property of Maxvolt Energy
            Industries Limited and is protected by applicable intellectual property laws. Your use of the
            App does not grant you any ownership rights in it.
          </p>
        </Section>

        <Section title="8. Availability &amp; Changes">
          <p>
            We aim to keep the App available at all times but do not guarantee uninterrupted access. We
            may update, modify, or discontinue features of the App at any time. We may also update these
            Terms from time to time; continued use of the App after changes take effect constitutes
            acceptance of the revised Terms.
          </p>
        </Section>

        <Section title="9. Termination of Access">
          <p>
            Your access to the App is tied to your employment or engagement with Maxvolt. Access will be
            revoked upon separation, termination, or at Maxvolt's discretion in case of a breach of these
            Terms or company policy.
          </p>
        </Section>

        <Section title="10. Disclaimer &amp; Limitation of Liability">
          <p>
            The App is provided "as is" for internal HR administration purposes. To the fullest extent
            permitted by law, Maxvolt disclaims liability for any indirect, incidental, or consequential
            loss arising from your use of, or inability to use, the App, except where such liability
            cannot be excluded under applicable law.
          </p>
        </Section>

        <Section title="11. Governing Law">
          <p>
            These Terms are governed by the laws of India. Any disputes arising out of or in connection
            with these Terms shall be subject to the exclusive jurisdiction of the courts at Ghaziabad,
            Uttar Pradesh.
          </p>
        </Section>

        <Section title="12. Contact Us">
          <p>
            For any questions about these Terms, please contact:
            <br /><strong>Maxvolt Energy Industries Limited — HR Department</strong>
            <br />Email: <a href="mailto:hr@maxvoltenergy.com" className="text-indigo-600 hover:underline">hr@maxvoltenergy.com</a>
            <br />Address: E-82 Bulandshahr Road Industrial Area, Ghaziabad, Uttar Pradesh – 201009, India
          </p>
        </Section>
      </div>
    </div>
  );
}
