import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { FileText } from 'lucide-react';
import UnderDevelopmentBanner from '@/components/UnderDevelopmentBanner';

export default function ComplianceReports() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <UnderDevelopmentBanner pageName="Compliance Reports" />
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Compliance Reports</h1>
          <p className="text-gray-600 mt-1">Generate statutory compliance reports</p>
        </div>

        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-500">Compliance reports feature</p>
            <p className="text-sm text-gray-400 mt-2">PF, ESI, TDS and other statutory reports</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}