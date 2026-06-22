export default function PrivacyPolicy() {
  return (
    <main className="max-w-4xl mx-auto p-6 md:p-12 text-gray-800 dark:text-gray-200 mt-10">
      <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">Privacy Policy</h1>
      <p className="mb-4"><strong>Last Updated:</strong> June 2026</p>

      <div className="space-y-6 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">1. Introduction</h2>
          <p>Welcome to Glide. We respect your privacy and are committed to protecting your personal data. This Privacy Policy explains how we collect, use, and safeguard your information when you use our mobile application and website.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">2. Information We Collect</h2>
          <p>When you use Glide, we collect the following types of information:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li><strong>Authentication Data:</strong> When you log in using Google OAuth, we collect your basic profile information, specifically your name, email address, and profile picture.</li>
            <li><strong>App Activity:</strong> We track your interactions within the app, including articles you like, reels you save, and comments you post in the comment sections.</li>
            <li><strong>Preferences:</strong> We store your selected sports league preferences to personalize your Match Center experience.</li>
            <li><strong>Diagnostic Data:</strong> We collect anonymous crash reports, performance metrics, and application logs to troubleshoot errors, optimize speed, and improve app stability.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">3. How We Use Your Information</h2>
          <p>We use your data strictly to provide and improve the Glide experience:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>To create and manage your user account securely.</li>
            <li>To enable social features, such as displaying your name and avatar next to your comments.</li>
            <li>To curate a personalized "Vault" of your saved and liked content.</li>
            <li>To maintain application performance and trace active server errors.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">4. Data Storage and Security</h2>
          <p>Your data is stored securely in our database. We implement industry-standard security measures and secure token-based authentication protocols to protect your personal information from unauthorized access, modification, or disclosure. We do not sell, rent, or trade your personal data to third parties.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">5. Children's Privacy</h2>
          <p>Glide is not intended for individuals under the age of 13. We do not knowingly collect or solicit personal information from children. If we discover that we have inadvertently collected data from a minor under 13, we will take immediate steps to delete that account and all associated records from our database.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">6. Your Rights</h2>
          <p>You have the right to access, update, or request the deletion of your personal data at any time. To request a complete deletion of your account and associated historical data (including all comments, likes, and saves), please contact us.</p>
        </section>
      </div>
    </main>
  );
}