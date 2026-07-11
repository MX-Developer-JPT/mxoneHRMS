import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Briefcase, MapPin, Clock, Users, Search, ChevronRight, Calendar } from 'lucide-react';
import { format, isPast } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

export default function PublicJobBoard() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('all');
  const [departments, setDepartments] = useState([]);

  useEffect(() => {
    loadJobs();
    base44.entities.Department.list().then(setDepartments).catch(() => {});
  }, []);

  const loadJobs = async () => {
    try {
      const allJobs = await base44.entities.JobRequisition.list('-published_date', 500);
      const active = allJobs.filter(j => {
        const isPublished = j.is_published === true || j.status === 'published' || j.status === 'approved';
        const notExpired = !j.application_deadline || !isPast(new Date(j.application_deadline));
        const notClosed  = !['closed', 'cancelled', 'rejected', 'hr_rejected', 'manager_rejected'].includes(j.status);
        return isPublished && notExpired && notClosed;
      });
      setJobs(active);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const filtered = jobs.filter(j => {
    const matchSearch = !search || j.position_title?.toLowerCase().includes(search.toLowerCase()) || j.department?.toLowerCase().includes(search.toLowerCase());
    const matchDept = filterDept === 'all' || j.department === filterDept;
    return matchSearch && matchDept;
  });

  const empTypeLabel = (t) => ({ full_time: 'Full Time', part_time: 'Part Time', contract: 'Contract', intern: 'Internship' }[t] || t);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-6 flex items-center gap-4">
          <img src="/favicon.svg?v=2" alt="Maxvolt Energy" className="h-12 object-contain" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Careers at Maxvolt Energy</h1>
            <p className="text-gray-500 text-sm">Explore open positions and join our team</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Search & Filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              className="pl-9"
              placeholder="Search positions..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant={filterDept === 'all' ? 'default' : 'outline'} onClick={() => setFilterDept('all')} className={filterDept === 'all' ? 'bg-orange-500 hover:bg-orange-600' : ''}>
              All Departments
            </Button>
            {departments.map(d => (
              <Button
                key={d.id}
                size="sm"
                variant={filterDept === d.name ? 'default' : 'outline'}
                onClick={() => setFilterDept(d.name)}
                className={filterDept === d.name ? 'bg-orange-500 hover:bg-orange-600' : ''}
              >
                {d.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Count */}
        <p className="text-sm text-gray-500">{filtered.length} open position{filtered.length !== 1 ? 's' : ''}</p>

        {/* Job Cards */}
        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading openings...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Briefcase className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No open positions found</p>
            <p className="text-gray-400 text-sm">Check back soon for new opportunities</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(job => (
              <Card key={job.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h2 className="text-lg font-bold text-gray-900">{job.position_title}</h2>
                        <Badge className="bg-orange-100 text-orange-700">{empTypeLabel(job.employment_type)}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mb-3">
                        <span className="flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" />{job.department}</span>
                        {job.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{job.location}</span>}
                        {job.experience_required && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{job.experience_required}</span>}
                        <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{job.number_of_positions} position(s)</span>
                      </div>
                      {job.job_description && (
                        <p className="text-sm text-gray-600 line-clamp-2">{job.job_description}</p>
                      )}
                      {job.required_skills?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {job.required_skills.slice(0, 5).map((s, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                          ))}
                          {job.required_skills.length > 5 && (
                            <Badge variant="outline" className="text-xs">+{job.required_skills.length - 5} more</Badge>
                          )}
                        </div>
                      )}
                      {job.application_deadline && (
                        <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Apply by: {safeDate(job.application_deadline, 'dd MMM yyyy')}
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0">
                      <a href={`/ApplyForJob?jobId=${job.id}`}>
                        <Button className="bg-orange-500 hover:bg-orange-600 gap-1">
                          Apply Now <ChevronRight className="w-4 h-4" />
                        </Button>
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="border-t bg-white py-4 text-center text-xs text-gray-400 mt-10">
        © {new Date().getFullYear()} Maxvolt Energy Industries Limited. All rights reserved.
      </div>
    </div>
  );
}