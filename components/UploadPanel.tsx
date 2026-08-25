'use client';

import * as React from 'react';
import { FileText, Lock, ShieldAlert, Upload } from 'lucide-react';
import { BANK_TEMPLATES } from '@/lib/banks/registry';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ConvertErrorCode } from '@/lib/schema';

const MAX_BYTES = 20 * 1024 * 1024;
const AUTO_DETECT = '__auto__';

export interface UploadSubmission {
  file: File;
  password?: string;
  bankHint?: string;
  /** Ledger code written into the accounting-import export, e.g. AXISBB. */
  bankCode?: string;
  allowLlmFallback: boolean;
}

interface UploadPanelProps {
  onSubmit: (submission: UploadSubmission) => void;
  /** Set when a previous attempt failed, so the form can prompt inline. */
  errorCode?: ConvertErrorCode;
  errorMessage?: string;
}

export function UploadPanel({ onSubmit, errorCode, errorMessage }: UploadPanelProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [password, setPassword] = React.useState('');
  const [bankHint, setBankHint] = React.useState<string>(AUTO_DETECT);
  const [bankCode, setBankCode] = React.useState('');
  const [allowLlmFallback, setAllowLlmFallback] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const needsPassword = errorCode === 'PASSWORD_REQUIRED' || errorCode === 'PASSWORD_INCORRECT';
  const suggestsLlm = errorCode === 'UNSUPPORTED_LAYOUT' || errorCode === 'PARSE_FAILED';

  // Focus the password box the moment we learn the PDF is encrypted.
  const passwordRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (needsPassword) passwordRef.current?.focus();
  }, [needsPassword, errorMessage]);

  function accept(candidate: File | undefined | null) {
    setLocalError(null);
    if (!candidate) return;

    if (!candidate.name.toLowerCase().endsWith('.pdf') && candidate.type !== 'application/pdf') {
      setLocalError('Only PDF statements are supported. Please upload the PDF your bank issued.');
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setLocalError('That file is larger than 20 MB. Please upload one statement period at a time.');
      return;
    }
    setFile(candidate);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setLocalError('Choose a PDF statement first.');
      return;
    }
    onSubmit({
      file,
      ...(password ? { password } : {}),
      ...(bankHint !== AUTO_DETECT ? { bankHint } : {}),
      ...(bankCode.trim() ? { bankCode: bankCode.trim() } : {}),
      allowLlmFallback,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Upload a statement</CardTitle>
          <CardDescription>
            PDF only, up to 20 MB. The file is processed in memory and never written to disk.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              accept(e.dataTransfer.files?.[0]);
            }}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Choose a PDF statement"
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
              'focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none',
              dragging ? 'border-primary bg-primary/5' : 'hover:bg-muted/60',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => accept(e.target.files?.[0])}
            />
            {file ? (
              <>
                <FileText className="text-primary size-7" />
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-muted-foreground text-xs">
                  {(file.size / 1024 / 1024).toFixed(2)} MB — click to choose a different file
                </p>
              </>
            ) : (
              <>
                <Upload className="text-muted-foreground size-7" />
                <p className="text-sm font-medium">Drop your statement here, or click to browse</p>
                <p className="text-muted-foreground text-xs">Your bank&rsquo;s original PDF works best</p>
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bank-hint">Bank</Label>
              <Select value={bankHint} onValueChange={setBankHint}>
                <SelectTrigger id="bank-hint">
                  <SelectValue placeholder="Detect automatically" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_DETECT}>Detect automatically</SelectItem>
                  {BANK_TEMPLATES.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.bankName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">Only needed if detection picks the wrong bank.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                Password <span className="text-muted-foreground font-normal">(if protected)</span>
              </Label>
              <Input
                ref={passwordRef}
                id="password"
                type="password"
                autoComplete="off"
                placeholder="Often your DOB, PAN or customer ID"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={needsPassword}
              />
              <p className="text-muted-foreground text-xs">Used once to open the PDF. Never stored or logged.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bank-code">
                Bank code <span className="text-muted-foreground font-normal">(for accounting import)</span>
              </Label>
              <Input
                id="bank-code"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. AXISBB"
                value={bankCode}
                onChange={(e) => setBankCode(e.target.value.toUpperCase())}
                maxLength={32}
              />
              <p className="text-muted-foreground text-xs">
                Your ledger code for this bank. Written to the <code>bk_cd</code> column of the accounting CSV.
              </p>
            </div>
          </div>

          <div className="bg-muted/50 flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              id="llm-consent"
              checked={allowLlmFallback}
              onCheckedChange={(v) => setAllowLlmFallback(v === true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="llm-consent" className="cursor-pointer">
                Allow AI-assisted column mapping if no built-in template matches
              </Label>
              <p className="text-muted-foreground text-xs">
                This sends the statement&rsquo;s table — including narrations and amounts — to Google (Gemini) to work out
                which column is which. The amounts themselves are always read by this app, never by the AI. Leave this
                off and unrecognised statements will simply fail instead.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {(localError || errorMessage) && (
        <Alert variant={needsPassword ? 'warning' : 'destructive'}>
          {needsPassword ? <Lock className="size-4 shrink-0" /> : <ShieldAlert className="size-4 shrink-0" />}
          <div>
            <AlertTitle>{titleFor(errorCode, localError)}</AlertTitle>
            <AlertDescription>{localError ?? errorMessage}</AlertDescription>
            {suggestsLlm && !allowLlmFallback && (
              <AlertDescription className="mt-2">
                Tick &ldquo;AI-assisted column mapping&rdquo; above and try again.
              </AlertDescription>
            )}
          </div>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={!file}>
          Convert statement
        </Button>
      </div>
    </form>
  );
}

function titleFor(code: ConvertErrorCode | undefined, localError: string | null): string {
  if (localError) return 'Check the file';
  switch (code) {
    case 'PASSWORD_REQUIRED':
      return 'This statement is password-protected';
    case 'PASSWORD_INCORRECT':
      return 'That password did not work';
    case 'SCANNED_PDF_UNSUPPORTED':
      return 'This PDF is a scan';
    case 'UNSUPPORTED_LAYOUT':
      return 'Layout not recognised';
    case 'RATE_LIMITED':
      return 'Too many conversions';
    default:
      return 'Conversion failed';
  }
}
