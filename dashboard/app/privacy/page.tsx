export default function PrivacyPolicy() {
  return (
    <main className="max-w-4xl mx-auto p-6 md:p-12 text-gray-800 dark:text-gray-200 mt-10">
      <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">Privacy Policy</h1>
      <p className="mb-4 text-sm text-gray-500"><strong>Last Updated:</strong> June 2026</p>

      <div className="space-y-6 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">1. Introduction</h2>
          <p>Welcome to Glide. We respect your privacy and are committed to protecting your personal data. This Privacy Policy explains how we collect, use, and safeguard your information when you use our mobile application and website. (Please note: Glide is not intended for individuals under the age of 13, and we do not knowingly collect personal information from children. If we discover we have inadvertently collected data from a minor, we will delete it immediately.)</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">2. Information We Collect</h2>
          <p>When you use Glide, we collect the following types of information:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li><strong>Account Data:</strong> When you sign in using Google OAuth, we collect your basic profile information, specifically your name, email address, and profile picture. We never see or store your password.</li>
            <li><strong>App Activity:</strong> We track your interactions within the app, including articles you like, reels you save, and comments you post in the comment sections.</li>
            <li><strong>Diagnostic Data:</strong> We collect anonymous crash reports, server logs (including IP addresses and browser types), and performance metrics to troubleshoot errors and understand usage patterns.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">3. How We Use Your Information</h2>
          <p>We use your data strictly to provide and improve the Glide experience:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>To create and manage your user account securely.</li>
            <li>To enable social features, such as displaying your name and avatar next to your comments.</li>
            <li>To curate a personalized "Vault" of your saved and liked content based on your sports league preferences.</li>
            <li>To maintain application performance and trace active server errors.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">4. Third Parties We Share Data With</h2>
          <p>Glide relies on a small set of trusted vendors to operate. Data is encrypted in transit (TLS), and we share data with these providers only to the extent needed to do their jobs. We do not sell your personal data to advertisers or data brokers.</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li><strong>Vercel & Render:</strong> These platforms host our frontend application and backend database (SQLite/Node). Your account data and comments live securely on these managed servers.</li>
            <li><strong>Google (OAuth, YouTube & Gemini AI):</strong> We use Google to authenticate your sign-in securely. We also utilize Google's Gemini AI to generate news summaries and the YouTube API for video embeds. We do not send your personal user data to the AI models.</li>
            <li><strong>Sentry:</strong> Sentry monitors our application for bugs and crashes. They receive anonymized diagnostic data to help us fix technical issues rapidly.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">5. Cookies and Local Storage</h2>
          <p>We use a small number of strictly necessary first-party cookies and local storage tokens to keep you securely signed in to your account and to remember your theme preferences (e.g., dark mode). We do not use third-party advertising or tracking cookies.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">6. Data Retention and Deletion</h2>
          <p>We keep your account and activity data for as long as your account remains active. You can delete individual comments directly within the app. To request a complete deletion of your entire account and all associated historical data, please contact us. We will process and complete your deletion request within 14 days. Anonymized diagnostic logs may persist slightly longer for security and abuse-prevention purposes.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">7. Your Rights</h2>
          <p>Depending on your jurisdiction (such as GDPR for the EU, CCPA for California, or PIPEDA for Canada), you have the right to access the personal data we hold about you, correct inaccurate data, request a portable copy of your data, or demand the deletion of your account. To exercise any of these rights, please email our support team.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">8. Updates to This Policy</h2>
          <p>We may update this Privacy Policy from time to time to reflect changes in our tech stack or legal requirements. We will indicate at the top of this policy when it was most recently updated. We encourage you to review this page periodically.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">9. Contact Us</h2>
          <p>If you have any questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact us at:</p>
          <p className="mt-2 font-medium">Email: support@glidesports.app</p>
        </section>
      </div>
    </main>
  );
}