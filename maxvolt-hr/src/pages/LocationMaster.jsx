import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Edit2, Trash2, MapPin, Loader2, Download, Users, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

export default function LocationMaster() {
  const [locations, setLocations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', city: '', state: '', is_active: true });
  const [expandedLocation, setExpandedLocation] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [locData, empData] = await Promise.all([
        base44.entities.AppLocation.list('-created_date'),
        base44.entities.Employee.list(),
      ]);
      setLocations(locData);
      setEmployees(empData);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const getEmployeesAtLocation = (locationName) => {
    return employees.filter(e => e.work_location === locationName);
  };

  const exportLocationEmployees = (locationName) => {
    const emps = getEmployeesAtLocation(locationName);
    if (emps.length === 0) { toast.info('No employees at this location'); return; }

    const headers = ['Employee Code', 'Name', 'Designation', 'Tier', 'Department', 'DOJ', 'DOB', 'Reporting Manager', 'Status'];
    const rows = emps.map(e => {
      const mgr = employees.find(m => m.user_id === e.reporting_manager_id);
      return [
        e.employee_code || '',
        e.display_name || '',
        e.designation || '',
        e.designation_tier || '',
        e.department || '',
        e.date_of_joining || '',
        e.date_of_birth || '',
        mgr?.display_name || '',
        e.status || 'active',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employees_${locationName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${emps.length} employees from ${locationName}`);
  };

  const openNew = () => {
    setEditingId(null);
    setForm({ name: '', address: '', city: '', state: '', is_active: true });
    setShowDialog(true);
  };

  const openEdit = (loc) => {
    setEditingId(loc.id);
    setForm({ name: loc.name || '', address: loc.address || '', city: loc.city || '', state: loc.state || '', is_active: loc.is_active !== false });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Location name is required'); return; }
    setSaving(true);
    try {
      if (editingId) {
        await base44.entities.AppLocation.update(editingId, form);
        toast.success('Location updated');
      } else {
        await base44.entities.AppLocation.create(form);
        toast.success('Location added');
      }
      setShowDialog(false);
      loadData();
    } catch (err) {
      toast.error('Error saving location');
    }
    setSaving(false);
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete location "${name}"?`)) return;
    try {
      await base44.entities.AppLocation.delete(id);
      toast.success('Location deleted');
      loadData();
    } catch (err) {
      toast.error('Error deleting location');
    }
  };

  const handleToggleActive = async (loc) => {
    try {
      await base44.entities.AppLocation.update(loc.id, { is_active: !loc.is_active });
      toast.success(loc.is_active ? 'Location deactivated' : 'Location activated');
      loadData();
    } catch (err) {
      toast.error('Error updating status');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64">Loading...</div>;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Location Master</h1>
            <p className="text-muted-foreground mt-1">Manage office locations and view employees by site</p>
          </div>
          <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Add Location</Button>
        </div>

        <Tabs defaultValue="locations">
          <TabsList>
            <TabsTrigger value="locations"><MapPin className="w-4 h-4 mr-1" /> Locations</TabsTrigger>
            <TabsTrigger value="employees"><Users className="w-4 h-4 mr-1" /> Employees by Location</TabsTrigger>
          </TabsList>

          <TabsContent value="locations">
            <Card>
              <CardHeader><CardTitle>All Locations ({locations.length})</CardTitle></CardHeader>
              <CardContent>
                {locations.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No locations added yet</p>
                ) : (
                  <div className="space-y-3">
                    {locations.map(loc => {
                      const empCount = getEmployeesAtLocation(loc.name).length;
                      return (
                        <div key={loc.id} className="flex items-center justify-between border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-full">
                              <MapPin className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">{loc.name}</p>
                              <p className="text-sm text-muted-foreground">{[loc.address, loc.city, loc.state].filter(Boolean).join(', ') || '—'}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{empCount} employee(s)</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge className={loc.is_active !== false ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}>
                              {loc.is_active !== false ? 'Active' : 'Inactive'}
                            </Badge>
                            <Switch checked={loc.is_active !== false} onCheckedChange={() => handleToggleActive(loc)} />
                            <Button size="sm" variant="ghost" onClick={() => openEdit(loc)}><Edit2 className="w-4 h-4" /></Button>
                            <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(loc.id, loc.name)}><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="employees">
            <div className="space-y-4">
              {locations.filter(l => l.is_active !== false).map(loc => {
                const emps = getEmployeesAtLocation(loc.name);
                const isExpanded = expandedLocation === loc.id;
                return (
                  <Card key={loc.id}>
                    <CardHeader
                      className="cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedLocation(isExpanded ? null : loc.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <MapPin className="w-5 h-5 text-primary" />
                          <div>
                            <CardTitle className="text-base">{loc.name}</CardTitle>
                            <p className="text-sm text-muted-foreground">{emps.length} employee(s)</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {emps.length > 0 && (
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); exportLocationEmployees(loc.name); }}>
                              <Download className="w-3 h-3 mr-1" /> Export CSV
                            </Button>
                          )}
                          <ChevronDown className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>
                    </CardHeader>
                    {isExpanded && (
                      <CardContent>
                        {emps.length === 0 ? (
                          <p className="text-center text-muted-foreground py-6">No employees at this location</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                                  <th className="py-2 px-2 font-medium">Code</th>
                                  <th className="py-2 px-2 font-medium">Name</th>
                                  <th className="py-2 px-2 font-medium">Designation</th>
                                  <th className="py-2 px-2 font-medium">Tier</th>
                                  <th className="py-2 px-2 font-medium">Department</th>
                                  <th className="py-2 px-2 font-medium">DOJ</th>
                                  <th className="py-2 px-2 font-medium">DOB</th>
                                  <th className="py-2 px-2 font-medium">Manager</th>
                                </tr>
                              </thead>
                              <tbody>
                                {emps.map(e => {
                                  const mgr = employees.find(m => m.user_id === e.reporting_manager_id);
                                  return (
                                    <tr key={e.id} className="border-b hover:bg-muted/30">
                                      <td className="py-2 px-2 font-mono text-xs">{e.employee_code}</td>
                                      <td className="py-2 px-2 font-medium">{e.display_name}</td>
                                      <td className="py-2 px-2">{e.designation}</td>
                                      <td className="py-2 px-2"><Badge variant="outline" className="text-xs">{e.designation_tier || '—'}</Badge></td>
                                      <td className="py-2 px-2">{e.department}</td>
                                      <td className="py-2 px-2 text-xs">{e.date_of_joining || '—'}</td>
                                      <td className="py-2 px-2 text-xs">{e.date_of_birth || '—'}</td>
                                      <td className="py-2 px-2">{mgr?.display_name || '—'}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
              {locations.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No locations configured yet</p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId ? 'Edit Location' : 'Add New Location'}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Location Name *</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g., Mumbai HQ" /></div>
              <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="Full address" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>City</Label><Input value={form.city} onChange={e => setForm({...form, city: e.target.value})} placeholder="City" /></div>
                <div><Label>State</Label><Input value={form.state} onChange={e => setForm({...form, state: e.target.value})} placeholder="State" /></div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={v => setForm({...form, is_active: v})} />
                <Label>Active</Label>
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {editingId ? 'Update Location' : 'Add Location'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}