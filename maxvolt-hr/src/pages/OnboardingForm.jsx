import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ob } from '@/lib/onboarding';
import OnboardingPortal from '@/pages/OnboardingPortal';
import OnboardingFormLegacy from '@/pages/OnboardingFormLegacy';

// New joiners invited by HR use the portal (HR's details are already on file). Someone who self-registered before
// sign-ups were closed has no HR-entered record, so they keep the previous form until HR approves them.
export default function OnboardingForm() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => { ob('ob_getMy').then(d => setState({ loading: false, data: d })).catch(() => setState({ loading: false, data: { hr_initiated: false } })); }, []);
  if (state.loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-orange-600" /></div>;
  return state.data?.hr_initiated ? <OnboardingPortal data={state.data} /> : <OnboardingFormLegacy />;
}
