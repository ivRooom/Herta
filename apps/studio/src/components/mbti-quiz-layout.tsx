import { Brain } from 'lucide-react';

export function MbtiQuizLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mbti-page">
      <div className="mbti-decoration mbti-decoration-mint" aria-hidden="true" />
      <div className="mbti-decoration mbti-decoration-lilac" aria-hidden="true" />
      <section className="mbti-panel">
        <header className="mbti-header">
          <div className="mbti-brand">
            <Brain aria-hidden="true" />
            <span>
              HERTA <b>MBTI</b>
            </span>
          </div>
          <h1>MBTI風性格診断</h1>
        </header>
        {children}
      </section>
    </main>
  );
}
