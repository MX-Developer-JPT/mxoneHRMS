import React, { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Clock, XCircle, Shield, Laptop, Building2, DollarSign, User } from 'lucide-react';

const DEPARTMENTS = [
  { key: 'hr', label: 'HR Department', icon: User, tasks: ['Collect ID card, access card', 'Complete exit formalities', 'Issue NOC'], roleMatch: ['hr', 'admin'] },
  { key: 'it', label: 'IT Department', icon: Laptop, tasks: ['Return laptop/equipment', 'Revoke system access', 'Transfer files/handover'], deptKeywords: ['it', 'information technology'] },
  { key: 'admin', label: 'Admin Department', icon: Building2, tasks: ['Return office keys', 'Return company assets', 'Parking/cafeteria clearance'], deptKeywords: ['admin', 'administration'] },
  { key: 'finance', label: 'Accounts & Finance', icon: DollarSign, tasks: ['Clear pending expenses', 'Loan/advance settlement', 'Final salary computation'], deptKeywords: ['finance', 'accounts', 'account'] },
  { key: 'reporting_manager', label: 'Reporting Manager', icon: Shield, tasks: ['Knowledge transfer complete', 'Handover documentation', 'Project transitions'], isManager: true },
];

function canActOnDept(dept, currentUser, isHR, exitRecord, onUpdate) {
  if (!currentUser || !onUpdate) return false;
  if (isHR) return true;
  const role = currentUser.custom_role || currentUser.role;
  // HR dept card — only HR/admin
  if (dept.roleMatch) return dept.roleMatch.includes(role);
  // Reporting manager card — the actual manager
  if (dept.isManager) return currentUser.id === exitRecord.manager_id || role === 'management';
  // Other depts — match by department name
  if (dept.deptMatch) {
    const empDept = currentUser.department || '';
    return empDept.trim().toLowerCase() === dept.deptMatch.trim().toLowerCase();
  }
  return false;
}

function DeptCard({ dept, checklist, currentUser, isHR, exitRecord, onUpdate }) {
  const [notes, setNotes] = useState(checklist[dept.key]?.notes || '');
  const [saving, setSaving] = useState(false);
  const Icon = dept.icon;
  const status = checklist[dept.key]?.status || 'pending';
  const clearedBy = checklist[dept.key]?.cleared_by;

  const role = currentUser ? (currentUser.custom_role || currentUser.role) : '';
  let canAct = false;
  if (onUpdate) {
    if (isHR) {
      canAct = true;
    } else if (dept.roleMatch) {
      canAct = dept.roleMatch.includes(role);
    } else if (dept.isManager) {
      canAct = currentUser?.id === exitRecord?.manager_id || role === 'management';
    } else if (dept.deptKeywords) {
      const empDept = (currentUser?.department || '').trim().toLowerCase();
      canAct = dept.deptKeywords.some(kw => empDept.includes(kw));
    }
  }

  const handleAction = async (newStatus) => {
    setSaving(true);
    await onUpdate(dept.key, newStatus, notes);
    setSaving(false);
  };

  return (
    <Card className={`border-2 ${status === 'cleared' ? 'border-green-300' : status === 'rejected' ? 'border-red-300' : 'border-gray-200'}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${status === 'cleared' ? 'bg-green-100' : status === 'rejected' ? 'bg-red-100' : 'bg-gray-100'}`}>
              <Icon className={`w-5 h-5 ${status === 'cleared' ? 'text-green-600' : status === 'rejected' ? 'text-red-600' : 'text-gray-500'}`} />
            </div>
            <div>
              <p className="font-semibold text-sm">{dept.label}</p>
              {clearedBy && <p className="text-xs text-gray-500">By: {clearedBy}</p>}
            </div>
          </div>
          <Badge className={status === 'cleared' ? 'bg-green-100 text-green-700' : status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}>
            {status === 'cleared' ? <CheckCircle2 className="w-3 h-3 mr-1 inline" /> : status === 'rejected' ? <XCircle className="w-3 h-3 mr-1 inline" /> : <Clock className="w-3 h-3 mr-1 inline" />}
            {status === 'cleared' ? 'Cleared' : status === 'rejected' ? 'Rejected' : 'Pending'}
          </Badge>
        </div>

        <ul className="space-y-1">
          {dept.tasks.map((task, i) => (
            <li key={i} className="text-xs text-gray-500 flex items-center gap-2">
              {status === 'cleared'
                ? <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                : <span className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0 inline-block" />}
              {task}
            </li>
          ))}
        </ul>

        {checklist[dept.key]?.notes && !canAct && (
          <p className="text-xs text-gray-600 bg-gray-50 p-2 rounded italic">"{checklist[dept.key].notes}"</p>
        )}

        {canAct && (
          <div className="space-y-2 pt-2 border-t">
            <Input
              className="text-xs h-7"
              placeholder="Add notes..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={saving || status === 'cleared'}
                className="bg-green-600 hover:bg-green-700 flex-1 h-7 text-xs"
                onClick={() => handleAction('cleared')}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" /> {status === 'cleared' ? 'Cleared ✓' : 'Mark Cleared'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving || status === 'rejected'}
                className="border-red-300 text-red-600 hover:bg-red-50 flex-1 h-7 text-xs"
                onClick={() => handleAction('rejected')}
              >
                <XCircle className="w-3 h-3 mr-1" /> Reject
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ClearanceStatus({ exitRecord, currentUser, isHR, onUpdate }) {
  const checklist = exitRecord?.clearance_checklist || {};
  const allCleared = DEPARTMENTS.every(d => checklist[d.key]?.status === 'cleared');

  return (
    <div className="space-y-4">
      {allCleared && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-green-600" />
          <p className="font-semibold text-green-700">All clearances completed! Exit process can proceed.</p>
        </div>
      )}

      {onUpdate && !isHR && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          You can clear your department's section below.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {DEPARTMENTS.map(dept => (
          <DeptCard
            key={dept.key}
            dept={dept}
            checklist={checklist}
            currentUser={currentUser}
            isHR={isHR}
            exitRecord={exitRecord}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    </div>
  );
}