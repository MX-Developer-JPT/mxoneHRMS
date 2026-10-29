import { useState, useEffect } from 'react';
import { Loader2, MessageSquare, Award, Users } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import GiveFeedback from '@/components/feedback360/GiveFeedback';
import Feedback360Results from '@/components/feedback360/Feedback360Results';
import HrOverview from '@/components/feedback360/HrOverview';

// 360° feedback: give feedback (self-assessment + colleagues), see your own results, and — for HR / admin — the ratings of everyone.
// Anonymity is enforced on the server: nobody sees who rated, and results stay hidden until 3 colleagues have rated.
export default function FeedbackSystem() {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('give');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => { base44.auth.me().then(setMe).catch(() => setMe({})); }, []);
  if (!me) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const role = me.custom_role || me.role;
  const isHr = ['hr', 'admin'].includes(role);
  const tabs = [
    { key: 'give', label: 'Give feedback', icon: MessageSquare },
    { key: 'my', label: 'My results', icon: Award },
    ...(isHr ? [{ key: 'all', label: 'All employees', icon: Users }] : []),
  ];

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">360° Feedback</h1>
        <p className="text-gray-500 text-sm mt-1">Honest, anonymous feedback from the people you work with — and a clear picture of how others see your work.</p>
      </div>

      <div className="flex gap-1 mb-5 border-b overflow-x-auto" role="tablist">
        {tabs.map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === 'give' && <GiveFeedback me={me} onGiven={() => setRefresh(x => x + 1)} />}
      {tab === 'my' && <Feedback360Results refreshKey={refresh} />}
      {tab === 'all' && isHr && <HrOverview />}
    </div>
  );
}
