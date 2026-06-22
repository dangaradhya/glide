export default function TermsOfService() {
    return (
      <main className="max-w-4xl mx-auto p-6 md:p-12 text-gray-800 dark:text-gray-200 mt-10">
        <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">Terms of Service</h1>
        <p className="mb-4"><strong>Last Updated:</strong> June 2026</p>
  
        <div className="space-y-6 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">1. Acceptance of Terms</h2>
            <p>By accessing or using the Glide application and website, you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you may not use our services.</p>
          </section>
  
          <section>
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">2. Content Aggregation & Intellectual Property</h2>
            <p>Glide is a content aggregator. The news articles, summaries, images, and video reels ("Third-Party Content") displayed within the app are the intellectual property of their respective original publishers and broadcasters (e.g., ESPN, SkySports, YouTube). Glide does not claim ownership over any Third-Party Content.</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Videos are embedded strictly via the official YouTube Player API in compliance with YouTube's Developer Terms of Service.</li>
              <li>News summaries are AI-generated factual transformations of publicly available RSS feeds, providing links directly back to the original source.</li>
            </ul>
          </section>
  
          <section>
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">3. User Conduct and Fan Zone Rules</h2>
            <p>When participating in the Fan Zone (commenting), you agree not to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Post content that is abusive, harassing, threatening, or discriminatory.</li>
              <li>Spam the platform or post unauthorized promotional material.</li>
              <li>Impersonate any person or entity.</li>
            </ul>
            <p className="mt-2">Glide reserves the right to remove any comments and terminate the accounts of users who violate these guidelines without prior notice.</p>
          </section>
  
          <section>
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">4. Disclaimer of Warranties</h2>
            <p>Glide is provided on an "AS IS" and "AS AVAILABLE" basis. We make no warranties, expressed or implied, regarding the accuracy, reliability, or availability of the aggregated sports data or app features.</p>
          </section>
  
          <section>
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">5. Governing Law</h2>
            <p>These Terms shall be governed by and construed in accordance with the laws of Ontario, Canada, without regard to its conflict of law provisions.</p>
          </section>
        </div>
      </main>
    );
  }