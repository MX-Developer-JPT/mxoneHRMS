import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { History, ListChecks } from 'lucide-react';
import GatePassHistory from '@/components/gatepass/GatePassHistory';
import { useGateBoard, usePassFilters, SummaryCards, FilterBar, PassCard, Empty, Loading } from '@/components/gatepass/gpShared';
import { ActionButton, ConfirmAction } from '@/components/gatepass/GatePassActions';
import GatePassDetail from '@/components/gatepass/GatePassDetail';

export default function GatePassApproval() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('approvals');
  const [openId, setOpenId] = useState(null);
  const [request, setRequest] = useState(null);
  useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);
  const { board, error, refreshing, reload } = useGateBoard();
  const role = user?.custom_role || user?.role;
  const isHR = ['hr', 'admin'].includes(role);
  // this page is about other people's passes
  const passes = (board?.passes || []).filter(p => p.employee_user_id !== user?.id || isHR);
  const filters = usePassFilters(passes, { group: 'pending' });

  // Front Desk Admin does not approve gate passes
  if (role === 'front_desk_admin') return <div className="p-8 text-center text-gray-600">Gate pass approval is not available for the Front Desk Admin role.</div>;

  const buttons = (p) => (p.can.approve ? <>
    <ActionButton action="approve" onClick={() => setRequest({ action: 'approve', pass: p })} />
    <ActionButton action="reject" onClick={() => setRequest({ action: 'reject', pass: p })} />
  </> : null);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Gate Pass Approvals</h1>
        <p className="text-gray-500 text-sm">{isHR ? 'All employee gate passes (HR view)' : 'Gate passes of your direct and indirect team'}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant={activeTab === 'approvals' ? 'default' : 'outline'} onClick={() => setActiveTab('approvals')}><ListChecks className="w-4 h-4 mr-1.5" />Requests</Button>
        <Button size="sm" variant={activeTab === 'history' ? 'default' : 'outline'} onClick={() => setActiveTab('history')}><History className="w-4 h-4 mr-1.5" />Team history</Button>
      </div>
      {activeTab === 'approvals' && <>
        {error && <p role="alert" className="text-sm text-red-600">{error} <button className="underline" onClick={reload}>Try again</button></p>}
        {!board || !user ? !error && <Loading /> : <>
          <SummaryCards passes={passes} active={filters.f.group} onPick={(group) => filters.set({ group })} />
          <FilterBar filters={filters} passes={passes} onRefresh={reload} refreshing={refreshing} />
          <div className="space-y-3">
            {filters.rows.length === 0
              ? <Empty title={filters.f.group === 'pending' && !filters.dirty ? 'No requests are waiting for approval' : 'No gate passes found'} hint="Try another tab or clear the filters." />
              : filters.rows.slice(0, 200).map(p => <PassCard key={p.id} pass={p} onOpen={(x) => setOpenId(x.id)} actions={buttons(p)} />)}
          </div>
        </>}
      </>}
      {activeTab === 'history' && user && <GatePassHistory filterManagerId={user.id} showEmployeeName={true} />}
      <ConfirmAction request={request} offices={board?.offices} onClose={() => setRequest(null)} onDone={reload} />
      <GatePassDetail passId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}
