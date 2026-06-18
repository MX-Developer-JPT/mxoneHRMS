import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { LogOut, ClipboardList, MessageSquare, FileText, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import ResignationForm from '../components/exit/ResignationForm';
import ExitStatusTracker from '../components/exit/ExitStatusTracker';
import ExitInterviewForm from '../components/exit/ExitInterviewForm';
import ClearanceStatus from '../components/exit/ClearanceStatus';

export default function MyExit() {
  const [user, setUser] = useState(null);
  const [exitRecord, setExitRecord] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('status');
  const [showResignForm, setShowResignForm] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const me = await base44.auth.me();
      setUser(me);
      const [exits, emps] = await Promise.all([
        base44.entities.Exit.filter({ user_id: me.id }),
        base44.entities.Employee.filter({ user_id: me.id })
      ]);
      setExitRecord(exits[0] || null);
      setEmployee(emps[0] || null);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  const STATUS_LABELS = {
    submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-800' },
    manager_approved: { label: 'Manager Approved', color: 'bg-yellow-100 text-yellow-800' },
    manager_rejected: { label: 'Manager Rejected', color: 'bg-red-100 text-red-800' },
    hr_approved: { label: 'HR Approved', color: 'bg-green-100 text-green-800' },
    hr_rejected: { label: 'HR Rejected', color: 'bg-red-100 text-red-800' },
    in_notice: { label: 'In Notice Period', color: 'bg-orange-100 text-orange-800' },
    clearance_pending: { label: 'Clearance Pending', color: 'bg-purple-100 text-purple-800' },
    clearance_done: { label: 'Clearance Done', color: 'bg-teal-100 text-teal-800' },
    fnf_pending: { label: 'F&F Pending', color: 'bg-indigo-100 text-indigo-800' },
    completed: { label: 'Completed', color: 'bg-green-200 text-green-900' },
    cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-600' },
  };

  const tabs = [
    { id: 'status', label: 'Status', icon: Clock },
    { id: 'clearance', label: 'Clearance', icon: ClipboardList },
    { id: 'interview', label: 'Exit Interview', icon: MessageSquare },
    { id: 'documents', label: 'Documents', icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2"><LogOut className="w-8 h-8 text-red-600" /> My Exit</h1>
            <p className="text-gray-600 mt-1">Manage your exit process</p>
          </div>
          {!exitRecord && (
            <Button className="bg-red-600 hover:bg-red-700" onClick={() => setShowResignForm(true)}>
              <LogOut className="w-4 h-4 mr-2" /> Submit Resignation
            </Button>
          )}
          {exitRecord && (
            <Badge className={`text-sm px-3 py-1 ${STATUS_LABELS[exitRecord.status]?.color || 'bg-gray-100'}`}>
              {STATUS_LABELS[exitRecord.status]?.label || exitRecord.status}
            </Badge>
          )}
        </div>

        {!exitRecord ? (
          <Card className="border-2 border-dashed border-red-200">
            <CardContent className="py-16 text-center">
              <LogOut className="w-16 h-16 mx-auto text-red-300 mb-4" />
              <h3 className="text-xl font-semibold text-gray-700">No Active Exit Request</h3>
              <p className="text-gray-500 mt-2 mb-6">If you wish to resign, please submit your resignation below.</p>
              <Button className="bg-red-600 hover:bg-red-700" onClick={() => setShowResignForm(true)}>
                Submit Resignation
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex gap-2 border-b overflow-x-auto pb-0">
              {tabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === tab.id ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                  >
                    <Icon className="w-4 h-4" /> {tab.label}
                  </button>
                );
              })}
            </div>

            {activeTab === 'status' && <ExitStatusTracker exitRecord={exitRecord} employee={employee} onRefresh={loadData} />}
            {activeTab === 'clearance' && (
              <ClearanceStatus
                exitRecord={exitRecord}
                currentUser={user ? { ...user, department: employee?.department } : null}
                isHR={false}
                onUpdate={null}
              />
            )}
            {activeTab === 'interview' && (
              <ExitInterviewForm exitRecord={exitRecord} user={user} onComplete={loadData} />
            )}
            {activeTab === 'documents' && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> Exit Documents</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {['completed', 'clearance_done', 'fnf_pending'].includes(exitRecord.status) ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                          <div>
                            <p className="font-medium">Relieving Letter</p>
                            <p className="text-sm text-gray-500">Official relieving from the organization</p>
                          </div>
                        </div>
                        {exitRecord.relieving_letter_generated ? (
                          <Button size="sm" variant="outline">Download</Button>
                        ) : <Badge className="bg-yellow-100 text-yellow-700">Pending</Badge>}
                      </div>
                      <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border">
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-blue-600" />
                          <div>
                            <p className="font-medium">Experience Letter</p>
                            <p className="text-sm text-gray-500">Certificate of employment</p>
                          </div>
                        </div>
                        {exitRecord.experience_letter_generated ? (
                          <Button size="sm" variant="outline">Download</Button>
                        ) : <Badge className="bg-yellow-100 text-yellow-700">Pending</Badge>}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-10 text-gray-500">
                      <AlertCircle className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                      Documents will be available after clearance is completed.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {showResignForm && (
          <ResignationForm
            user={user}
            employee={employee}
            onClose={() => setShowResignForm(false)}
            onSubmitted={() => { setShowResignForm(false); loadData(); toast.success('Resignation submitted successfully'); }}
          />
        )}
      </div>
    </div>
  );
}