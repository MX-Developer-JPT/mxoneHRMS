import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { getTourStepsForRole, selectorForStep } from '@/lib/appTour';
import { createPageUrl } from '@/utils';

const FIND_TIMEOUT_MS = 3000;
const FIND_POLL_MS = 100;

// Waits for `selector` to appear in the DOM with a real, visible size —
// pages are lazy-loaded (React.lazy/Suspense), so the target nav item or
// element may not exist yet the instant we navigate there. Resolves with
// null (not a rejection) on timeout so the caller can gracefully fall back
// to a centered card instead of a broken tour.
function waitForElement(selector, timeoutMs = FIND_TIMEOUT_MS) {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      const el = selector ? document.querySelector(selector) : null;
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) { resolve(el); return; }
      }
      if (Date.now() - start > timeoutMs) { resolve(null); return; }
      setTimeout(tick, FIND_POLL_MS);
    };
    tick();
  });
}

export default function AppTour({ user, recheckKey }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [active, setActive] = useState(false);
  const [steps, setSteps] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState(null); // null = centered card (no element found/targeted)
  const [ready, setReady] = useState(false); // false while locating this step's target
  const checkedRef = useRef(false);

  const role = user?.custom_role || user?.role;

  // Checks for a pending/in-progress walkthrough — but a NEW user's tour
  // must not actually start until they've cleared their forced password
  // change and uploaded a profile photo (getMyTourStatus's own
  // onboarding_ready flag, computed server-side against the same fields
  // ForceChangePassword/Layout.jsx's forced-photo dialog gate on). Layout.jsx
  // is mounted the whole time those two forced flows are still blocking the
  // screen, so this effect's first run can genuinely see onboarding_ready:
  // false — deliberately NOT a one-shot check in that case: `user` changes
  // identity after a password change (App.jsx's checkAppState() refetches
  // it), and `recheckKey` is Layout.jsx's own photoRequiredEmpId (null the
  // instant the forced photo dialog resolves) — both re-run this effect,
  // so the tour starts the moment onboarding actually completes rather than
  // only on a later reload. checkedRef only latches once the tour has
  // actually been shown, so it can't reopen itself later just because
  // `user`/recheckKey happen to change again after that (e.g. any other
  // profile edit).
  useEffect(() => {
    if (!user || checkedRef.current) return;
    base44.functions.invoke('getMyTourStatus', {}).then(res => {
      const d = res.data || res;
      const tour = d?.tour;
      if (tour && (tour.status === 'pending' || tour.status === 'in_progress') && d.onboarding_ready) {
        checkedRef.current = true;
        const roleSteps = getTourStepsForRole(role);
        setSteps(roleSteps);
        setStepIndex(Math.min(tour.current_step || 0, roleSteps.length - 1));
        setActive(true);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, recheckKey]);

  const locateStep = useCallback(async (index, stepList) => {
    const stepDef = stepList[index];
    if (!stepDef) return;
    setReady(false);
    setTargetRect(null);

    // Navigate first if this step lives on a different page — the
    // "auto-navigate + highlight" behavior: the user only ever has to read
    // and click Next, never hunt for the right page themselves.
    if (stepDef.page && createPageUrl(stepDef.page) !== location.pathname) {
      navigate(createPageUrl(stepDef.page));
    }

    const selector = selectorForStep(stepDef);
    const el = selector ? await waitForElement(selector) : null;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' in window ? 'instant' : 'auto' });
      // Re-measure after scroll settles.
      requestAnimationFrame(() => {
        setTargetRect(el.getBoundingClientRect());
        setReady(true);
      });
    } else {
      setTargetRect(null); // graceful fallback — centered card, still explains the feature
      setReady(true);
    }
  }, [navigate, location.pathname]);

  useEffect(() => {
    if (active && steps.length) locateStep(stepIndex, steps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, steps]);

  // Keep the spotlight aligned if the window resizes or the page scrolls
  // while a step is showing (e.g. a long page).
  useEffect(() => {
    if (!active || !ready) return;
    const stepDef = steps[stepIndex];
    const selector = stepDef && selectorForStep(stepDef);
    if (!selector) return;
    const reposition = () => {
      const el = document.querySelector(selector);
      if (el) setTargetRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [active, ready, stepIndex, steps]);

  const persist = (action, nextIndex) => {
    base44.functions.invoke('updateMyTourProgress', { action, current_step: nextIndex }).catch(() => {});
  };

  const handleNext = () => {
    const isLast = stepIndex === steps.length - 1;
    if (isLast) {
      persist('complete', stepIndex);
      setActive(false);
      return;
    }
    const next = stepIndex + 1;
    persist('advance', next);
    setStepIndex(next);
  };

  const handleBack = () => {
    if (stepIndex === 0) return;
    const prev = stepIndex - 1;
    setStepIndex(prev);
  };

  const handleSkip = () => {
    persist('skip', stepIndex);
    setActive(false);
  };

  if (!active || !steps.length) return null;
  const stepDef = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  // Card position: near the target rect when we have one and it's ready,
  // otherwise dead-centered (welcome/closing steps, or a target that
  // couldn't be found on this viewport).
  const cardStyle = (() => {
    if (!ready) return { opacity: 0 }; // avoid a flash at the wrong spot while locating
    if (!targetRect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
    const margin = 16;
    const cardWidth = 340;
    const spaceBelow = window.innerHeight - targetRect.bottom;
    const placeBelow = spaceBelow > 220 || targetRect.top < 220;
    const top = placeBelow ? targetRect.bottom + margin : Math.max(margin, targetRect.top - margin);
    const left = Math.min(Math.max(margin, targetRect.left), window.innerWidth - cardWidth - margin);
    return placeBelow
      ? { top, left, transform: 'none' }
      : { top, left, transform: 'translateY(-100%)' };
  })();

  return (
    <div className="fixed inset-0 z-[9999]" role="dialog" aria-label="App walkthrough">
      {/* Dark overlay with a spotlight cutout around the target element,
          using the box-shadow trick (a transparent box the exact size of
          the target, with an enormous shadow covering everything else) —
          no clip-path/mask complexity needed. Absorbs clicks everywhere
          except the tooltip card itself, so the tour can't be derailed by
          an accidental click on the real UI underneath. */}
      {targetRect && ready ? (
        <div
          className="absolute rounded-lg transition-all duration-200 pointer-events-none"
          style={{
            top: targetRect.top - 6, left: targetRect.left - 6,
            width: targetRect.width + 12, height: targetRect.height + 12,
            boxShadow: '0 0 0 9999px rgba(15,23,42,0.72)',
            outline: '2px solid #0A84FF',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/70" />
      )}
      {/* Full-screen click absorber so nothing behind the tour is reachable
          except via the tour's own controls. */}
      <div className="absolute inset-0" />

      {/* Tooltip / card */}
      <div
        className="absolute w-[340px] max-w-[calc(100vw-32px)] bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl p-5 space-y-3 transition-opacity duration-150"
        style={cardStyle}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-[15px] text-[#1D1D1F] dark:text-white leading-snug">{stepDef.title}</h3>
          <button onClick={handleSkip} className="text-[#8E8E93] hover:text-[#1D1D1F] dark:hover:text-white shrink-0" aria-label="Skip tour">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[13.5px] text-[#6E6E73] dark:text-[#98989D] leading-relaxed">{stepDef.description}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-[#8E8E93] font-medium">{stepIndex + 1} of {steps.length}</span>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button variant="outline" size="sm" onClick={handleBack} className="h-8 px-2.5">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button size="sm" onClick={handleNext} className="h-8 px-3.5 bg-[#007AFF] hover:bg-[#0066D6]">
              {isLast ? 'Finish' : 'Next'} {!isLast && <ChevronRight className="w-3.5 h-3.5 ml-1" />}
            </Button>
          </div>
        </div>
        {!isLast && (
          <button onClick={handleSkip} className="text-[11px] text-[#8E8E93] hover:text-[#1D1D1F] dark:hover:text-white underline underline-offset-2">
            Skip tour
          </button>
        )}
      </div>
    </div>
  );
}
