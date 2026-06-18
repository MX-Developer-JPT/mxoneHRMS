import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, AlertTriangle, FileText, User, Calendar, IndianRupee } from 'lucide-react';

export default function MyInsurance() {
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const user = await base44.auth.me();
    const emps = await base44.entities.Employee.filter({ user_id: user.id });
    setEmployee(emps[0] || null);
    setLoading(false);
  };

  const isExpired = (date) => date && new Date(date) < new Date();
  const isExpiringSoon = (date) => {
    if (!date) return false;
    const diff = (new Date(date) - new Date()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  };

  const getStatusBadge = (ins) => {
    if (!ins?.has_insurance) return <Badge className="bg-gray-100 text-gray-600 border-0">No Insurance on Record</Badge>;
    if (isExpired(ins.validity_date)) return <Badge className="bg-red-100 text-red-700 border-0">Expired</Badge>;
    if (isExpiringSoon(ins.validity_date)) return <Badge className="bg-yellow-100 text-yellow-700 border-0">Expiring Soon</Badge>;
    return <Badge className="bg-green-100 text-green-700 border-0">Active</Badge>;
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  const ins = employee?.insurance || {};

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Insurance</h1>
        <p className="text-gray-500 text-sm mt-1">Your insurance details on record</p>
      </div>

      {!employee ? (
        <div className="text-center py-16 text-gray-400">No employee record found.</div>
      ) : !ins.has_insurance ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-16 text-center">
            <Shield className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">No insurance information on record.</p>
            <p className="text-gray-400 text-sm mt-1">Please contact HR to update your insurance details.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Status Banner */}
          {(isExpired(ins.validity_date) || isExpiringSoon(ins.validity_date)) && (
            <div className={`flex items-center gap-3 p-4 rounded-xl ${isExpired(ins.validity_date) ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}`}>
              <AlertTriangle className={`w-5 h-5 ${isExpired(ins.validity_date) ? 'text-red-500' : 'text-yellow-600'}`} />
              <p className={`text-sm font-medium ${isExpired(ins.validity_date) ? 'text-red-700' : 'text-yellow-700'}`}>
                {isExpired(ins.validity_date) ? 'Your insurance policy has expired. Please contact HR.' : 'Your insurance policy is expiring within 30 days. Please renew soon.'}
              </p>
            </div>
          )}

          {/* Policy Details */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg"><Shield className="w-5 h-5 text-blue-600" />Policy Details</CardTitle>
                {getStatusBadge(ins)}
              </div>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Insurance Type</p>
                <p className="font-medium mt-0.5">{ins.insurance_type || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Insurer / Company</p>
                <p className="font-medium mt-0.5">{ins.insurer_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Policy Number</p>
                <p className="font-medium mt-0.5">{ins.policy_number || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1"><IndianRupee className="w-3 h-3" />Sum Insured</p>
                <p className="font-medium mt-0.5">{ins.sum_insured ? `₹${Number(ins.sum_insured).toLocaleString('en-IN')}` : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1"><Calendar className="w-3 h-3" />Validity Date</p>
                <p className={`font-medium mt-0.5 ${isExpired(ins.validity_date) ? 'text-red-600' : isExpiringSoon(ins.validity_date) ? 'text-yellow-600' : ''}`}>
                  {ins.validity_date || '—'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Nominee Details */}
          {ins.nominee_name && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><User className="w-5 h-5 text-purple-600" />Nominee Details</CardTitle>
              </CardHeader>
              <CardContent className="grid md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Nominee Name</p>
                  <p className="font-medium mt-0.5">{ins.nominee_name}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Relationship</p>
                  <p className="font-medium mt-0.5">{ins.nominee_relationship || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Date of Birth</p>
                  <p className="font-medium mt-0.5">{ins.nominee_date_of_birth || '—'}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Insurance Card / Document */}
          {ins.card_url && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><FileText className="w-5 h-5 text-green-600" />Insurance Card / Document</CardTitle>
              </CardHeader>
              <CardContent>
                <a
                  href={ins.card_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
                >
                  <FileText className="w-4 h-4" />
                  View Insurance Card / Policy Document
                </a>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}