import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';

export default function RoleBasedRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    base44.auth.me().then((user) => {
      const role = user?.custom_role || user?.role;
      if (role === 'onboarding_pending') {
        navigate('/OnboardingForm', { replace: true });
      } else if (role === 'gate_admin') {
        navigate('/GateAdminDashboard', { replace: true });
      } else {
        navigate('/Dashboard', { replace: true });
      }
    }).catch(() => {
      navigate('/Dashboard', { replace: true });
    });
  }, []);

  return null;
}