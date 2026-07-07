import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '../api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Printer, TrendingDown, IndianRupee, Calendar, FileText, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';

const fmt = (n) => n == null ? '₹0' : '₹' + Math.round(n || 0).toLocaleString('en-IN');
const pct = (n) => (n || 0).toFixed(2) + '%';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FY_MONTHS   = ['APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC','JAN','FEB','MAR'];

function KPICard({ title, value, sub, icon: Icon, color = 'blue' }) {
  const colors = { blue: 'text-blue-600', green: 'text-green-600', orange: 'text-orange-600', red: 'text-red-600', purple: 'text-purple-600' };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-gray-500">{title}</p>
            <p className={`text-2xl font-bold mt-1 ${colors[color]}`}>{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
          </div>
          {Icon && <Icon className={`h-8 w-8 ${colors[color]} opacity-30`} />}
        </div>
      </CardContent>
    </Card>
  );
}

function RegimeCard({ label, calc, chosen, recommended }) {
  const isChosen = chosen === label.toLowerCase();
  const isRecommended = recommended === label.toLowerCase();
  return (
    <Card className={`border-2 transition-all ${isChosen ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-sm">{label} Regime</span>
          <div className="flex gap-1">
            {isRecommended && <Badge className="bg-green-100 text-green-700 text-xs">Recommended</Badge>}
            {isChosen && <Badge className="bg-blue-500 text-white text-xs">Selected</Badge>}
          </div>
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Taxable Income</span><span className="font-medium">{fmt(calc?.taxable_income)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Tax</span><span className="font-medium">{fmt(calc?.tax_before_rebate)}</span></div>
          {calc?.rebate_87a > 0 && <div className="flex justify-between text-green-600"><span>Rebate 87A</span><span>- {fmt(calc?.rebate_87a)}</span></div>}
          <div className="flex justify-between"><span className="text-gray-500">Cess (4%)</span><span className="font-medium">{fmt(calc?.cess)}</span></div>
          <div className="flex justify-between border-t pt-1 mt-1 font-bold"><span>Annual Tax</span><span className="text-blue-700">{fmt(calc?.total_tax)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-500">Monthly TDS</span><span>{fmt(Math.round((calc?.total_tax || 0) / 12))}</span></div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MyTax() {
  const navigate = useNavigate();
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => setUserId(u?.id)).catch(() => {});
  }, []);

  useEffect(() => {
    if (userId) loadWorksheet();
  }, [month, year, userId]);

  const loadWorksheet = async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('getTaxWorksheet', {
        user_id: userId,
        month: parseInt(month),
        year: parseInt(year),
      });
      const d = res.data || res;
      if (d.success) setData(d);
      else setError(d.error || 'Failed to load tax worksheet');
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const printWorksheet = () => {
    if (!data?.html) return;
    const w = window.open('', '_blank');
    w.document.write(data.html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 500);
  };

  const fyStart = parseInt(month) >= 4 ? parseInt(year) : parseInt(year) - 1;
  const years = [String(now.getFullYear()), String(now.getFullYear() - 1), String(now.getFullYear() + 1)];

  if (loading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <div className="text-center text-gray-500">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
        Loading tax worksheet…
      </div>
    </div>
  );

  if (error) return (
    <div className="p-6">
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-6 text-center">
          <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-2" />
          <p className="text-red-700 font-medium">{error}</p>
          <Button variant="outline" className="mt-3" onClick={loadWorksheet}>Retry</Button>
        </CardContent>
      </Card>
    </div>
  );

  const s = data?.summary || {};
  const tc = data?.tax_calculation || {};
  const decl = data?.investments || {};

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Tax</h1>
          <p className="text-sm text-gray-500 mt-0.5">FY {fyStart}–{(fyStart + 1).toString().slice(-2)} · Income Tax Worksheet</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-28 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((m, i) => (
                <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-24 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={printWorksheet}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Annual Gross" value={fmt(data?.totals?.total_income)} sub={`FY ${fyStart}-${(fyStart+1).toString().slice(-2)}`} icon={IndianRupee} color="blue" />
        <KPICard title="Taxable Income" value={fmt(tc.taxable_income)} sub={s.chosen_regime === 'new' ? 'New Regime' : 'Old Regime'} icon={TrendingDown} color="orange" />
        <KPICard title="Annual Tax" value={fmt(s.annual_tax)} sub={tc.rebate_87a > 0 ? `After ₹${(tc.rebate_87a||0).toLocaleString('en-IN')} 87A rebate` : ''} icon={FileText} color={s.annual_tax === 0 ? 'green' : 'red'} />
        <KPICard title="Monthly TDS" value={fmt(s.monthly_tds)} sub={`${s.remaining_months} months remaining`} icon={Calendar} color="purple" />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="bg-gray-100">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="worksheet">Tax Worksheet</TabsTrigger>
          <TabsTrigger value="monthwise">Month-wise TDS</TabsTrigger>
          <TabsTrigger value="declarations">Declarations</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RegimeCard label="New" calc={data?.regime_comparison?.new} chosen={s.chosen_regime} recommended={s.recommended_regime} />
            <RegimeCard label="Old" calc={data?.regime_comparison?.old} chosen={s.chosen_regime} recommended={s.recommended_regime} />
          </div>

          {/* Earnings breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Earnings Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-y">
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Component</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">YTD</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Projection</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Total</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Exempt</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Taxable</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.earnings || []).map((row, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2">{row.description}</td>
                      <td className="text-right px-4 py-2">{fmt(row.ytd)}</td>
                      <td className="text-right px-4 py-2 text-gray-400">{fmt(row.projection)}</td>
                      <td className="text-right px-4 py-2 font-medium">{fmt(row.total)}</td>
                      <td className="text-right px-4 py-2 text-green-600">{row.exempt > 0 ? fmt(row.exempt) : '-'}</td>
                      <td className="text-right px-4 py-2 font-medium">{fmt(row.taxable)}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100 font-bold">
                    <td className="px-4 py-2">Total</td>
                    <td className="text-right px-4 py-2"></td>
                    <td className="text-right px-4 py-2"></td>
                    <td className="text-right px-4 py-2">{fmt(data?.totals?.total_income)}</td>
                    <td className="text-right px-4 py-2 text-green-600">{data?.totals?.exempt > 0 ? fmt(data?.totals?.exempt) : '-'}</td>
                    <td className="text-right px-4 py-2">{fmt(data?.totals?.taxable)}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Tax computation summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tax Computation</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {[
                  ['Taxable Income', fmt(data?.totals?.taxable)],
                  ['Less: Standard Deduction', `- ${fmt(tc.standard_deduction)}`],
                  ...(s.chosen_regime === 'old' && tc.chapter_via > 0 ? [['Less: Chapter VIA', `- ${fmt(tc.chapter_via)}`]] : []),
                  ['= Net Taxable Income', fmt(tc.taxable_income)],
                  ['Tax on above (slabs)', fmt(tc.tax_before_rebate)],
                  ...(tc.rebate_87a > 0 ? [['Less: Rebate u/s 87A', `- ${fmt(tc.rebate_87a)}`]] : []),
                  ['Add: Cess @ 4%', `+ ${fmt(tc.cess)}`],
                  ['Annual Tax Liability', fmt(s.annual_tax)],
                  ['YTD TDS Deducted', `- ${fmt(s.ytd_tds)}`],
                  ['Remaining Tax', fmt(s.remaining_tax)],
                  ['Monthly TDS (spread over ' + s.remaining_months + ' months)', fmt(s.monthly_tds)],
                ].map(([label, val], i) => (
                  <div key={i} className={`flex justify-between py-1 ${label.startsWith('=') || label === 'Annual Tax Liability' ? 'border-t font-bold pt-2' : ''} ${label === 'Monthly TDS' + (s.remaining_months ? ' (spread over ' + s.remaining_months + ' months)' : '') ? 'text-blue-700 font-bold border-t pt-2' : ''}`}>
                    <span className="text-gray-600">{label}</span>
                    <span className={val.startsWith('-') ? 'text-green-600' : ''}>{val}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Slab wise */}
          {(data?.slab_wise || []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Slab-wise Calculation ({s.chosen_regime === 'new' ? 'New Regime' : 'Old Regime'})</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-y">
                      <th className="text-right px-4 py-2 font-medium text-gray-600">From</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">To</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Taxable</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Rate</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.slab_wise || []).map((s, i) => (
                      <tr key={i} className="border-b hover:bg-gray-50">
                        <td className="text-right px-4 py-2">{fmt(s.income_from)}</td>
                        <td className="text-right px-4 py-2">{s.income_to === Infinity || s.income_to > 1e9 ? 'Above' : fmt(s.income_to)}</td>
                        <td className="text-right px-4 py-2">{fmt(s.taxable_income)}</td>
                        <td className="text-right px-4 py-2">{s.tax_rate}%</td>
                        <td className="text-right px-4 py-2 font-medium">{fmt(s.tax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Worksheet (HTML frame) */}
        <TabsContent value="worksheet" className="mt-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Income Tax Worksheet</CardTitle>
              <Button size="sm" variant="outline" onClick={printWorksheet}>
                <Printer className="h-4 w-4 mr-1" /> Print / Download
              </Button>
            </CardHeader>
            <CardContent className="p-0 overflow-auto max-h-[70vh]">
              {data?.html ? (
                <iframe
                  srcDoc={data.html}
                  style={{ width: '100%', minHeight: '600px', border: 'none' }}
                  title="Income Tax Worksheet"
                />
              ) : (
                <div className="p-8 text-center text-gray-400">No worksheet data available</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Month-wise TDS */}
        <TabsContent value="monthwise" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Month-wise TDS · FY {fyStart}–{(fyStart+1).toString().slice(-2)}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-y">
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Month</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Tax Payable</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Tax Deducted</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.month_wise || []).map((row, i) => {
                    const diff = (row.tax_payable || 0) - (row.tax_deducted || 0);
                    return (
                      <tr key={i} className={`border-b hover:bg-gray-50 ${row.fy_month === (parseInt(month) >= 4 ? parseInt(month) - 3 : parseInt(month) + 9) ? 'bg-blue-50' : ''}`}>
                        <td className="px-4 py-2 font-medium">{row.label} {row.cal_year}</td>
                        <td className="text-right px-4 py-2">{row.tax_payable != null ? fmt(row.tax_payable) : <span className="text-gray-300">–</span>}</td>
                        <td className="text-right px-4 py-2">{row.tax_deducted != null ? fmt(row.tax_deducted) : <span className="text-gray-300">–</span>}</td>
                        <td className="text-right px-4 py-2">
                          {row.tax_deducted == null ? (
                            <Badge variant="outline" className="text-xs text-gray-400">Pending</Badge>
                          ) : diff === 0 ? (
                            <Badge className="bg-green-100 text-green-700 text-xs">Matched</Badge>
                          ) : diff > 0 ? (
                            <Badge className="bg-amber-100 text-amber-700 text-xs">Short {fmt(diff)}</Badge>
                          ) : (
                            <Badge className="bg-blue-100 text-blue-700 text-xs">Excess {fmt(-diff)}</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-bold">
                    <td className="px-4 py-2">Total</td>
                    <td className="text-right px-4 py-2">{fmt(s.annual_tax)}</td>
                    <td className="text-right px-4 py-2">{fmt(s.ytd_tds)}</td>
                    <td className="text-right px-4 py-2">
                      {s.remaining_tax > 0
                        ? <Badge className="bg-orange-100 text-orange-700 text-xs">Pending {fmt(s.remaining_tax)}</Badge>
                        : <Badge className="bg-green-100 text-green-700 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Complete</Badge>
                      }
                    </td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Declarations */}
        <TabsContent value="declarations" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {s.declaration_status === 'not_declared' ? (
                <Badge className="bg-red-100 text-red-700">No Declaration Filed</Badge>
              ) : (
                <Badge className="bg-green-100 text-green-700"><CheckCircle2 className="h-3 w-3 mr-1" />Declaration {s.declaration_status}</Badge>
              )}
              <span className="text-sm text-gray-500">FY {fyStart}–{(fyStart+1).toString().slice(-2)}</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate(createPageUrl('TaxDeclaration'))}>
              Update Declaration <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>

          {/* 80C */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-gray-700">Section 80C (Limit: ₹1,50,000)</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1 text-sm">
                {[
                  ['Employee PF Contribution', decl.emp_pf],
                  ['Declared 80C Investments', decl.sec80C],
                ].filter(([, v]) => v > 0).map(([label, val], i) => (
                  <div key={i} className="flex justify-between py-1 border-b last:border-0">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-medium">{fmt(val)}</span>
                  </div>
                ))}
                <div className="flex justify-between py-2 font-bold border-t">
                  <span>80C Total (Allowed)</span>
                  <span className="text-blue-700">{fmt(decl.section_12b_deduction || decl.sec80C)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Other */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-gray-700">Other Deductions</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1 text-sm">
                {[
                  ['80D – Health Insurance', decl.sec80D],
                  ['80CCD(1B) – NPS Additional', decl.sec80CCD1B],
                  ['80E – Education Loan Interest', decl.sec80E],
                  ['80G – Donations', decl.sec80G],
                ].filter(([, v]) => v > 0).map(([label, val], i) => (
                  <div key={i} className="flex justify-between py-1 border-b last:border-0">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-medium">{fmt(val)}</span>
                  </div>
                ))}
                <div className="flex justify-between py-2 font-bold border-t">
                  <span>Chapter VIA Total</span>
                  <span className="text-blue-700">{fmt(decl.chapter_via_total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {s.chosen_regime === 'new' && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="p-4 flex gap-2">
                <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700">You are on the <strong>New Tax Regime</strong>. Chapter VIA deductions (80C, 80D, etc.) do not apply. Only the standard deduction of ₹75,000 is available.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
