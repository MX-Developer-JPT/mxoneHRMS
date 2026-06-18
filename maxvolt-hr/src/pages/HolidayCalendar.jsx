import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar as CalendarIcon, Trash2, List, Grid, ToggleLeft, ToggleRight } from 'lucide-react';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay } from 'date-fns';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const typeColors = {
  public: 'bg-blue-100 text-blue-800',
  company: 'bg-green-100 text-green-800',
  optional: 'bg-orange-100 text-orange-800'
};

const typeDotsColors = {
  public: 'bg-blue-500',
  company: 'bg-green-500',
  optional: 'bg-orange-500'
};

function MonthCalendar({ year, month, holidays, workingDayOverrides, onDayClick, onToggleWorkingDay }) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days = eachDayOfInterval({ start: firstDay, end: lastDay });
  const startPad = getDay(firstDay);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{MONTH_NAMES[month]} {year}</CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_NAMES.map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-500">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map(day => {
            const dayHolidays = holidays.filter(h => isSameDay(new Date(h.date), day));
            const dayOfWeek = getDay(day);
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const dateKey = format(day, 'yyyy-MM-dd');
            const isWorkingOverride = workingDayOverrides[dateKey] === true;
            const isOffOverride = workingDayOverrides[dateKey] === false;
            const isWorkingDay = isWeekend ? isWorkingOverride : !isOffOverride;

            return (
              <div
                key={day.toISOString()}
                className={`relative text-center text-xs p-1 rounded cursor-pointer transition-colors min-h-[32px] flex flex-col items-center justify-start
                  ${dayHolidays.length > 0 ? 'bg-blue-50 border border-blue-200' :
                    isWeekend && isWorkingOverride ? 'bg-green-50 border border-green-200' :
                    isWeekend ? 'bg-gray-50 text-gray-400' : 'hover:bg-gray-50'}`}
                onClick={() => {
                  if (dayHolidays.length > 0) {
                    onDayClick(dayHolidays);
                  } else if (isWeekend) {
                    onToggleWorkingDay(dateKey, !isWorkingOverride);
                  }
                }}
                title={isWeekend ? (isWorkingOverride ? 'Working day (click to set as off)' : 'Off day (click to set as working)') : ''}
              >
                <span className={`font-medium ${dayHolidays.length > 0 ? 'text-blue-700' : isWeekend && isWorkingOverride ? 'text-green-700' : ''}`}>
                  {day.getDate()}
                </span>
                <div className="flex gap-0.5 flex-wrap justify-center mt-0.5">
                  {dayHolidays.map((h, i) => (
                    <div key={i} className={`w-1.5 h-1.5 rounded-full ${typeDotsColors[h.type]}`} title={h.name} />
                  ))}
                  {isWeekend && isWorkingOverride && <div className="w-1.5 h-1.5 rounded-full bg-green-500" title="Working" />}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function HolidayCalendar() {
  const [holidays, setHolidays] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('calendar');
  const [selectedDayHolidays, setSelectedDayHolidays] = useState(null);
  // workingDayOverrides: { 'yyyy-MM-dd': true (working) | false (off) }
  const [workingDayOverrides, setWorkingDayOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem('workingDayOverrides') || '{}'); } catch { return {}; }
  });

  const [formData, setFormData] = useState({
    name: '',
    date: '',
    type: 'public',
    year: new Date().getFullYear(),
    description: '',
    applicable_departments: []
  });

  useEffect(() => {
    loadData();
  }, [selectedYear]);

  const loadData = async () => {
    try {
      const holidayData = await base44.entities.Holiday.filter({ year: selectedYear }, 'date');
      setHolidays(holidayData);
      setLoading(false);
    } catch (error) {
      console.error('Error loading holidays:', error);
      setLoading(false);
    }
  };

  const handleToggleWorkingDay = (dateKey, makeWorking) => {
    const updated = { ...workingDayOverrides };
    if (makeWorking) {
      updated[dateKey] = true;
    } else {
      delete updated[dateKey];
    }
    setWorkingDayOverrides(updated);
    localStorage.setItem('workingDayOverrides', JSON.stringify(updated));
    toast.success(makeWorking ? `${dateKey} marked as working day` : `${dateKey} reset to off day`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const holidayData = { ...formData, year: new Date(formData.date).getFullYear() };
      if (editingHoliday) {
        await base44.entities.Holiday.update(editingHoliday.id, holidayData);
        toast.success('Holiday updated successfully');
      } else {
        await base44.entities.Holiday.create(holidayData);
        toast.success('Holiday created successfully');
      }
      setShowForm(false);
      setEditingHoliday(null);
      setFormData({ name: '', date: '', type: 'public', year: new Date().getFullYear(), description: '', applicable_departments: [] });
      loadData();
    } catch (error) {
      toast.error('Failed to save holiday');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this holiday?')) return;
    try {
      await base44.entities.Holiday.delete(id);
      toast.success('Holiday deleted successfully');
      setSelectedDayHolidays(null);
      loadData();
    } catch (error) {
      toast.error('Failed to delete holiday');
    }
  };

  const handleEdit = (holiday) => {
    setEditingHoliday(holiday);
    setFormData({
      name: holiday.name,
      date: holiday.date,
      type: holiday.type,
      year: holiday.year,
      description: holiday.description || '',
      applicable_departments: holiday.applicable_departments || []
    });
    setSelectedDayHolidays(null);
    setShowForm(true);
  };

  const holidaysByMonth = holidays.reduce((acc, holiday) => {
    const month = new Date(holiday.date).getMonth();
    if (!acc[month]) acc[month] = [];
    acc[month].push(holiday);
    return acc;
  }, {});

  if (loading && holidays.length === 0) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Holiday Calendar</h1>
            <p className="text-gray-600 mt-1 text-sm md:text-base">Manage company holidays and events</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto flex-wrap">
            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026, 2027].map(year => (
                  <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex border rounded-md overflow-hidden">
              <Button
                variant={viewMode === 'calendar' ? 'default' : 'ghost'}
                size="sm"
                className="rounded-none"
                onClick={() => setViewMode('calendar')}
              >
                <Grid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                className="rounded-none"
                onClick={() => setViewMode('list')}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
            <Dialog open={showForm} onOpenChange={(open) => {
              setShowForm(open);
              if (!open) {
                setEditingHoliday(null);
                setFormData({ name: '', date: '', type: 'public', year: new Date().getFullYear(), description: '', applicable_departments: [] });
              }
            }}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="w-5 h-5 mr-2" />
                  Add Holiday
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingHoliday ? 'Edit Holiday' : 'Add Holiday'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label>Holiday Name *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Republic Day"
                      required
                    />
                  </div>
                  <div>
                    <Label>Date *</Label>
                    <Input
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label>Type *</Label>
                    <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">Public Holiday</SelectItem>
                        <SelectItem value="company">Company Holiday</SelectItem>
                        <SelectItem value="optional">Optional Holiday</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Holiday description"
                      rows={2}
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                    <Button type="submit">{editingHoliday ? 'Update' : 'Create'}</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{holidays.filter(h => h.type === 'public').length}</p>
              <p className="text-xs text-gray-600 mt-1">Public Holidays</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{holidays.filter(h => h.type === 'company').length}</p>
              <p className="text-xs text-gray-600 mt-1">Company Holidays</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{holidays.filter(h => h.type === 'optional').length}</p>
              <p className="text-xs text-gray-600 mt-1">Optional Holidays</p>
            </CardContent>
          </Card>
        </div>

        {/* Legend */}
        {viewMode === 'calendar' && (
          <div className="flex gap-4 flex-wrap items-center">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-blue-500" /><span className="text-xs text-gray-600">Public Holiday</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-green-500" /><span className="text-xs text-gray-600">Company Holiday / Working Weekend</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-orange-500" /><span className="text-xs text-gray-600">Optional</span></div>
            <span className="text-xs text-gray-400">· Click on any Sat/Sun to toggle it as a working day</span>
          </div>
        )}

        {/* Calendar View */}
        {viewMode === 'calendar' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {MONTH_NAMES.map((_, month) => (
              <MonthCalendar
                key={month}
                year={selectedYear}
                month={month}
                holidays={holidays.filter(h => new Date(h.date).getMonth() === month)}
                workingDayOverrides={workingDayOverrides}
                onDayClick={setSelectedDayHolidays}
                onToggleWorkingDay={handleToggleWorkingDay}
              />
            ))}
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          Object.keys(holidaysByMonth).length > 0 ? (
            <div className="space-y-4">
              {Object.keys(holidaysByMonth).sort((a, b) => a - b).map(month => (
                <Card key={month}>
                  <CardHeader>
                    <CardTitle className="text-lg">{MONTH_NAMES[parseInt(month)]} {selectedYear}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {holidaysByMonth[month].map(holiday => (
                        <div key={holiday.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border rounded-lg hover:bg-gray-50 transition-colors">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold text-sm">{holiday.name}</p>
                              <Badge className={typeColors[holiday.type]} style={{ fontSize: '10px' }}>{holiday.type.toUpperCase()}</Badge>
                            </div>
                            <p className="text-xs text-gray-600">{format(new Date(holiday.date), 'EEEE, MMMM d, yyyy')}</p>
                            {holiday.description && <p className="text-xs text-gray-500 mt-1">{holiday.description}</p>}
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleEdit(holiday)}>Edit</Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDelete(holiday.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <CalendarIcon className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-500">No holidays for {selectedYear}</p>
                <p className="text-sm text-gray-400 mt-2">Click "Add Holiday" to get started</p>
              </CardContent>
            </Card>
          )
        )}

        {/* Day click modal */}
        {selectedDayHolidays && (
          <Dialog open={!!selectedDayHolidays} onOpenChange={() => setSelectedDayHolidays(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{format(new Date(selectedDayHolidays[0].date), 'MMMM d, yyyy')}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                {selectedDayHolidays.map(holiday => (
                  <div key={holiday.id} className="border rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold">{holiday.name}</p>
                      <Badge className={typeColors[holiday.type]} style={{ fontSize: '10px' }}>{holiday.type.toUpperCase()}</Badge>
                    </div>
                    {holiday.description && <p className="text-xs text-gray-500">{holiday.description}</p>}
                    <div className="flex gap-2 mt-2">
                      <Button variant="outline" size="sm" onClick={() => handleEdit(holiday)}>Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(holiday.id)}>Delete</Button>
                    </div>
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}