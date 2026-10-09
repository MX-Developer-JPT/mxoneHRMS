import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GraduationCap } from 'lucide-react';
import LdOverviewTab from '@/components/ld/LdOverviewTab';
import LdJoinersTab from '@/components/ld/LdJoinersTab';
import LdCatalogueTab from '@/components/ld/LdCatalogueTab';
import LdAssessmentsTab from '@/components/ld/LdAssessmentsTab';
import LdSkillsCertsTab from '@/components/ld/LdSkillsCertsTab';
import LdTrainersTab from '@/components/ld/LdTrainersTab';
import LdReportsTab from '@/components/ld/LdReportsTab';
import LdSettingsTab from '@/components/ld/LdSettingsTab';
import PauseControl from '@/components/ld/PauseControl';

// HR / L&D control centre — new-joiner induction control, catalogue, assessments, skills,
// certificates, trainers, reports and configuration.
export default function LdControlCentre() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><GraduationCap className="w-6 h-6 text-blue-600" />Learning &amp; Development — Control Centre</h1>
        <p className="text-sm text-gray-500">New-joiner induction, mandatory training, assessments, capability and compliance — in one place.</p>
      </div>
      <PauseControl />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="joiners">New joiners</TabsTrigger>
          <TabsTrigger value="catalogue">Catalogue &amp; assignments</TabsTrigger>
          <TabsTrigger value="assessments">Assessments</TabsTrigger>
          <TabsTrigger value="skills">Skills &amp; certificates</TabsTrigger>
          <TabsTrigger value="trainers">Trainers</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">{tab === 'overview' && <LdOverviewTab />}</TabsContent>
        <TabsContent value="joiners">{tab === 'joiners' && <LdJoinersTab />}</TabsContent>
        <TabsContent value="catalogue">{tab === 'catalogue' && <LdCatalogueTab />}</TabsContent>
        <TabsContent value="assessments">{tab === 'assessments' && <LdAssessmentsTab />}</TabsContent>
        <TabsContent value="skills">{tab === 'skills' && <LdSkillsCertsTab />}</TabsContent>
        <TabsContent value="trainers">{tab === 'trainers' && <LdTrainersTab />}</TabsContent>
        <TabsContent value="reports">{tab === 'reports' && <LdReportsTab />}</TabsContent>
        <TabsContent value="settings">{tab === 'settings' && <LdSettingsTab />}</TabsContent>
      </Tabs>
    </div>
  );
}
