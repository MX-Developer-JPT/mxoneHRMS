import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Plus, HelpCircle, AlertCircle, MessageSquare, UserCheck, Filter, Send } from 'lucide-react';
import MobileSelect from '@/components/MobileSelect';
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';



const statusColors = {
  open: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  resolved: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-800',
};

const priorityColors = {
  low: 'bg-gray-100 text-gray-800',
  medium: 'bg-blue-100 text-blue-800',
  high: 'bg-orange-100 text-orange-800',
  urgent: 'bg-red-100 text-red-800',
};

function TicketDetailDialog({ ticket, user, allUsers, departments, helpdeskCategories, isHR, isDeptHandler, onUpdate, onClose }) {
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState(ticket.status);
  const [assignedTo, setAssignedTo] = useState(ticket.assigned_to || '');
  const [assignedDept, setAssignedDept] = useState(ticket.assigned_department || '');
  const [resolution, setResolution] = useState(ticket.resolution || '');
  const [saving, setSaving] = useState(false);

  const canManage = isHR || isDeptHandler;
  const raisedBy = allUsers.find(u => u.id === ticket.user_id);
  const assignee = allUsers.find(u => u.id === ticket.assigned_to);
  const cat = helpdeskCategories.find(c => c.code === ticket.category);

  const handleAddComment = async () => {
    if (!comment.trim()) return;
    setSaving(true);
    const newComment = {
      author_id: user.id,
      author_name: user.full_name,
      author_role: user.role,
      text: comment.trim(),
      timestamp: new Date().toISOString(),
    };
    const comments = [...(ticket.comments || []), newComment];
    await base44.entities.Ticket.update(ticket.id, { comments });
    setComment('');
    setSaving(false);
    onUpdate();
    toast.success('Comment added');
  };

  const handleSaveHR = async () => {
    setSaving(true);
    const updates = { status, assigned_to: assignedTo || null, assigned_department: assignedDept || null };
    if (resolution) updates.resolution = resolution;
    if (status === 'resolved' && !ticket.resolved_date) updates.resolved_date = new Date().toISOString();
    await base44.entities.Ticket.update(ticket.id, updates);
    setSaving(false);
    onUpdate();
    onClose();
    toast.success('Ticket updated');
  };

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
      {/* Header Info */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <Badge className={statusColors[ticket.status]}>{ticket.status.replace('_', ' ').toUpperCase()}</Badge>
          <Badge className={priorityColors[ticket.priority]}>{ticket.priority.toUpperCase()}</Badge>
          <Badge variant="outline">{cat?.label}</Badge>
        </div>
        <p className="text-sm text-gray-700">{ticket.description}</p>
        <div className="text-xs text-gray-500 flex flex-wrap gap-4">
          <span>Raised by: <strong>{raisedBy?.full_name || 'Unknown'}</strong></span>
          <span>Date: <strong>{safeDate(ticket.created_date, 'MMM d, yyyy')}</strong></span>
          {assignee && <span>Assigned: <strong>{assignee.full_name}</strong></span>}
          {ticket.assigned_department && <span>Dept: <strong>{ticket.assigned_department}</strong></span>}
        </div>
      </div>

      {/* Management Controls (HR or dept handler) */}
      {canManage && (
        <div className="border rounded-lg p-4 space-y-3 bg-blue-50">
          <p className="text-sm font-semibold text-blue-800">{isHR ? 'HR Actions' : 'Department Actions'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isHR && (
              <div>
                <Label className="text-xs">Route to Department</Label>
                <Select value={assignedDept} onValueChange={setAssignedDept}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select dept" /></SelectTrigger>
                  <SelectContent>
                    {departments.map(d => (
                      <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isHR && (
              <div>
                <Label className="text-xs">Assign To</Label>
                <Select value={assignedTo} onValueChange={setAssignedTo}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Assign person" /></SelectTrigger>
                  <SelectContent>
                    {allUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name} {u.role ? `(${u.role})` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={isHR ? '' : 'col-span-2'}>
              <Label className="text-xs">Resolution Note</Label>
              <Input className="h-8 text-sm" value={resolution} onChange={e => setResolution(e.target.value)} placeholder="Resolution summary" />
            </div>
          </div>
          <Button size="sm" onClick={handleSaveHR} disabled={saving} className="w-full">
            <UserCheck className="w-3 h-3 mr-1" />{saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}

      {/* Resolution display for employees who can't manage */}
      {!canManage && ticket.resolution && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-green-800 mb-1">Resolution</p>
          <p className="text-sm text-gray-700">{ticket.resolution}</p>
        </div>
      )}

      {/* Comments Thread */}
      <div>
        <p className="text-sm font-semibold mb-2 flex items-center gap-1">
          <MessageSquare className="w-4 h-4" /> Comments ({ticket.comments?.length || 0})
        </p>
        <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
          {(ticket.comments || []).length === 0 && (
            <p className="text-xs text-gray-400 text-center py-3">No comments yet</p>
          )}
          {(ticket.comments || []).map((c, i) => (
            <div key={i} className={`p-3 rounded-lg text-sm ${c.author_id === user.id ? 'bg-blue-50 ml-4' : 'bg-gray-50 mr-4'}`}>
              <div className="flex justify-between items-center mb-1">
                <span className="font-medium text-xs">{c.author_name} <span className="text-gray-400 font-normal capitalize">({c.author_role})</span></span>
                <span className="text-xs text-gray-400">{safeDate(c.timestamp, 'MMM d, h:mm a')}</span>
              </div>
              <p className="text-gray-700">{c.text}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Add a comment..."
            rows={2}
            className="flex-1 text-sm"
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleAddComment(); }}
          />
          <Button size="sm" onClick={handleAddComment} disabled={saving || !comment.trim()} className="self-end">
            <Send className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Helpdesk() {
  const [user, setUser] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [helpdeskCategories, setHelpdeskCategories] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [myDepartment, setMyDepartment] = useState(null);

  const [formData, setFormData] = useState({
    category: '',
    priority: 'medium',
    subject: '',
    description: ''
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const isHR = currentUser.role === 'hr' || currentUser.role === 'admin';

      const [allTickets, deptData, catData, myEmployee] = await Promise.all([
        base44.entities.Ticket.list('-created_date', 500),
        base44.entities.Department.list(),
        base44.entities.HelpdeskCategory.list(),
        base44.entities.Employee.filter({ user_id: currentUser.id })
      ]);

      let userData = [];
      try {
        const usersResp = await base44.functions.invoke('getAllUsers', {});
        userData = usersResp?.data?.users || [];
      } catch (_) {}

      const employeeRecord = myEmployee?.[0];
      const myDept = employeeRecord?.department || null;

      // HR sees all; employees see own tickets + tickets routed to their department or assigned to them
      let ticketData;
      if (isHR) {
        ticketData = allTickets;
      } else {
        ticketData = allTickets.filter(t =>
          t.user_id === currentUser.id ||
          t.assigned_to === currentUser.id ||
          (myDept && t.assigned_department &&
            t.assigned_department.trim().toLowerCase() === myDept.trim().toLowerCase())
        );
      }

      setTickets(ticketData);
      setAllUsers(userData);
      setDepartments(deptData);
      setHelpdeskCategories(catData.filter(c => c.is_active !== false));
      // store my dept for use in render
      setMyDepartment(myDept);
      setLoading(false);
    } catch (error) {
      console.error('Error loading tickets:', error);
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.category) { toast.error('Please select a category'); return; }

    const cat = helpdeskCategories.find(c => c.code === formData.category);
    // Optimistic update
    const optimisticTicket = {
      id: 'optimistic-' + Date.now(),
      ...formData,
      user_id: user.id,
      status: 'open',
      assigned_department: cat?.default_department_name || '',
      created_date: new Date().toISOString(),
    };
    setTickets(prev => [optimisticTicket, ...prev]);
    setShowForm(false);
    setFormData({ category: '', priority: 'medium', subject: '', description: '' });

    try {
      await base44.entities.Ticket.create({
        ...formData,
        user_id: user.id,
        status: 'open',
        assigned_department: cat?.default_department_name || ''
      });
      toast.success('Ticket raised successfully');
      loadData();
    } catch (error) {
      setTickets(prev => prev.filter(t => t.id !== optimisticTicket.id)); // revert
      toast.error('Failed to raise ticket');
    }
  };

  if (loading || !user) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  const isHR = user.role === 'hr' || user.role === 'admin';
  // A dept employee can resolve tickets routed to their department or assigned directly to them
  const isDeptHandler = (ticket) => !isHR && ticket && ticket.user_id !== user.id && (
    ticket.assigned_to === user.id ||
    (myDepartment && ticket.assigned_department?.trim().toLowerCase() === myDepartment.trim().toLowerCase())
  );

  const filteredTickets = tickets.filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterCategory !== 'all' && t.category !== filterCategory) return false;
    return true;
  });

  const stats = {
    open: tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    resolved: tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length,
    total: tickets.length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">{isHR ? 'Helpdesk Dashboard' : 'My Helpdesk'}</h1>
            <p className="text-gray-600 mt-1">{isHR ? 'Manage and resolve employee support tickets' : 'Raise and track your support tickets'}</p>
          </div>
          <Dialog open={showForm} onOpenChange={setShowForm}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-5 h-5 mr-2" />Raise Ticket
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Raise Support Ticket</DialogTitle>
                <DialogDescription>Your ticket will be automatically routed to the relevant department.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Category *</Label>
                  <MobileSelect
                    value={formData.category}
                    onValueChange={(v) => setFormData({ ...formData, category: v })}
                    placeholder="Select category"
                    label="Select Category"
                    options={helpdeskCategories.map(cat => ({
                      value: cat.code,
                      label: cat.name + (cat.default_department_name ? ` → ${cat.default_department_name}` : '')
                    }))}
                  />
                </div>
                <div>
                  <Label>Priority</Label>
                  <MobileSelect
                    value={formData.priority}
                    onValueChange={(v) => setFormData({ ...formData, priority: v })}
                    placeholder="Select priority"
                    label="Select Priority"
                    options={[
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'high', label: 'High' },
                      { value: 'urgent', label: 'Urgent' },
                    ]}
                  />
                </div>
                <div>
                  <Label>Subject *</Label>
                  <Input value={formData.subject} onChange={(e) => setFormData({ ...formData, subject: e.target.value })} placeholder="Brief description" required />
                </div>
                <div>
                  <Label>Description *</Label>
                  <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Detailed description of your issue" rows={4} required />
                </div>
                <div className="flex gap-3 justify-end">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                  <Button type="submit">Submit Ticket</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Open', count: stats.open, color: 'text-blue-600', bg: 'bg-blue-100', icon: AlertCircle, filterVal: 'open' },
            { label: 'In Progress', count: stats.in_progress, color: 'text-yellow-600', bg: 'bg-yellow-100', icon: HelpCircle, filterVal: 'in_progress' },
            { label: 'Resolved', count: stats.resolved, color: 'text-green-600', bg: 'bg-green-100', icon: UserCheck, filterVal: 'resolved' },
            { label: 'Total', count: stats.total, color: 'text-purple-600', bg: 'bg-purple-100', icon: MessageSquare, filterVal: 'all' },
          ].map(s => (
            <Card key={s.label} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilterStatus(s.filterVal)}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-3 rounded-full ${s.bg}`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
                <div><p className="text-xs text-gray-500">{s.label}</p><p className={`text-2xl font-bold ${s.color}`}>{s.count}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters (HR only) */}
        {isHR && (
          <Card>
            <CardContent className="p-4 flex flex-wrap gap-3 items-center">
              <Filter className="w-4 h-4 text-gray-500" />
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-40 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {helpdeskCategories.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-xs text-gray-500 ml-auto">{filteredTickets.length} ticket{filteredTickets.length !== 1 ? 's' : ''}</span>
            </CardContent>
          </Card>
        )}

        {/* Ticket List */}
        <Card>
          <CardHeader>
            <CardTitle>{isHR ? 'All Employee Tickets' : 'My Tickets & Assigned Tickets'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filteredTickets.length > 0 ? filteredTickets.map(ticket => {
                const cat = helpdeskCategories.find(c => c.code === ticket.category);
                const raisedBy = allUsers.find(u => u.id === ticket.user_id);
                return (
                  <div
                    key={ticket.id}
                    className="border rounded-lg p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => setSelectedTicket(ticket)}
                  >
                    <div className="flex flex-wrap justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-semibold truncate">{ticket.subject}</p>
                          <Badge className={statusColors[ticket.status]}>{ticket.status.replace('_', ' ').toUpperCase()}</Badge>
                          <Badge className={priorityColors[ticket.priority]}>{ticket.priority.toUpperCase()}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                          <span>{cat?.name || ticket.category}</span>
                          {(isHR || isDeptHandler(ticket)) && raisedBy && <span>By: <strong>{raisedBy.full_name}</strong></span>}
                          {ticket.assigned_department && <span>→ <strong>{ticket.assigned_department}</strong></span>}
                          {!isHR && ticket.assigned_to === user.id && ticket.user_id !== user.id && <Badge className="bg-indigo-100 text-indigo-800 text-xs">Assigned to You</Badge>}
                          {!isHR && isDeptHandler(ticket) && ticket.assigned_to !== user.id && <Badge className="bg-purple-100 text-purple-800 text-xs">Dept. Ticket</Badge>}
                          {ticket.comments?.length > 0 && (
                            <span className="flex items-center gap-0.5"><MessageSquare className="w-3 h-3" />{ticket.comments.length}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 text-right">
                        <p>{safeDate(ticket.created_date, 'MMM d, yyyy')}</p>
                        {ticket.resolved_date && <p className="text-green-600">Resolved {safeDate(ticket.resolved_date, 'MMM d')}</p>}
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <p className="text-center text-gray-500 py-8">No tickets found</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Ticket Detail Dialog */}
        {selectedTicket && (
          <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{selectedTicket.subject}</DialogTitle>
                <DialogDescription>Ticket #{selectedTicket.id?.slice(-6).toUpperCase()}</DialogDescription>
              </DialogHeader>
              <TicketDetailDialog
               ticket={selectedTicket}
               user={user}
               allUsers={allUsers}
               departments={departments}
               helpdeskCategories={helpdeskCategories}
               isHR={isHR}
               isDeptHandler={isDeptHandler(selectedTicket)}
                onUpdate={() => { loadData(); setSelectedTicket(prev => tickets.find(t => t.id === prev?.id) || prev); }}
                onClose={() => setSelectedTicket(null)}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}