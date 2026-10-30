import React, { useState } from 'react';
import {
  Globe,
  Sparkles,
  Film,
  Copy,
  Check,
  ExternalLink,
  Download,
  RefreshCw,
  X,
  Maximize2,
  Minimize2,
  Wand2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  CHROME_EXTENSION_FOLDER_PATH,
  sendCommandToWebBridge,
  pingHuellasExtension,
} from '../utils/webStudioBridge';

interface WebStudioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  extensionInstalled: boolean;
  activeStage: number;
  stageTitle: string;
  bridgeStatusMsg: string;
  bridgeStatusType: 'IDLE' | 'WORKING' | 'SUCCESS' | 'ERROR';
  aiEngineMode: 'WEB_FREE' | 'API_KEY';
  onToggleAiEngineMode: (mode: 'WEB_FREE' | 'API_KEY') => void;
  onSendStagePromptToGeminiWeb: () => void;
  onGrabLastGeminiResponse: () => void;
  onSendCustomPromptToFlow: (prompt: string) => void;
}

export const WebStudioDrawer: React.FC<WebStudioDrawerProps> = ({
  isOpen,
  onClose,
  extensionInstalled,
  activeStage,
  stageTitle,
  bridgeStatusMsg,
  bridgeStatusType,
  aiEngineMode,
  onToggleAiEngineMode,
  onSendStagePromptToGeminiWeb,
  onGrabLastGeminiResponse,
  onSendCustomPromptToFlow,
}) => {
  const [activeTab, setActiveTab] = useState<'gemini' | 'flow' | 'setup'>(
    extensionInstalled ? 'gemini' : 'gemini'
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedExtUrl, setCopiedExtUrl] = useState(false);
  const [quickFlowPrompt, setQuickFlowPrompt] = useState('');
  const [iframeKeyGemini, setIframeKeyGemini] = useState(1);
  const [iframeKeyFlow, setIframeKeyFlow] = useState(1);

  if (!isOpen) return null;

  const handleCopyFolderPath = () => {
    navigator.clipboard.writeText(CHROME_EXTENSION_FOLDER_PATH);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2200);
  };

  const handleCopyChromeExtensionsUrl = () => {
    navigator.clipboard.writeText('chrome://extensions');
    setCopiedExtUrl(true);
    setTimeout(() => setCopiedExtUrl(false), 2200);
  };

  return (
    <aside
      className={`${
        isExpanded ? 'w-full lg:w-[64%]' : 'w-full lg:w-[46%]'
      } border-l border-amber-500/30 bg-[#110f0c] flex flex-col shrink-0 transition-all duration-200 select-none`}
      style={{ height: 'calc(100vh - 57px)' }}
    >
      {/* Top Header of Embedded Studio */}
      <div className="p-3 bg-[#17140f] border-b border-slate-800 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
            <Globe className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-300">
                Estudio Web Gratis (Gemini &amp; Google Flow)
              </h3>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 border ${
                  extensionInstalled
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/40 cursor-pointer'
                }`}
                onClick={() => {
                  pingHuellasExtension();
                  if (!extensionInstalled) setActiveTab('setup');
                }}
                title={
                  extensionInstalled
                    ? 'Extensión Puente de Chrome conectada y activa'
                    : 'Haz clic para ver cómo activar la extensión en 10 segundos'
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    extensionInstalled ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                  }`}
                />
                {extensionInstalled ? 'Puente Activo' : 'Activar Extensión (10s)'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Usa tu cuota gratuita/suscripción web de Gemini y Google Flow sin gastar API Key
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Switch default engine mode */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-[10px] font-bold">
            <button
              type="button"
              onClick={() => onToggleAiEngineMode('WEB_FREE')}
              className={`px-2 py-1 rounded-md cursor-pointer transition ${
                aiEngineMode === 'WEB_FREE'
                  ? 'bg-emerald-500 text-slate-950 font-black'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Los botones 'Generar con Gemini' usarán tu cuenta web gratis sin gastar API Key"
            >
              🌐 Cuota Web Gratis
            </button>
            <button
              type="button"
              onClick={() => onToggleAiEngineMode('API_KEY')}
              className={`px-2 py-1 rounded-md cursor-pointer transition ${
                aiEngineMode === 'API_KEY'
                  ? 'bg-amber-500 text-slate-950 font-black'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Los botones 'Generar con Gemini' usarán tu Gemini API Key"
            >
              🔑 Usar API Key
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer"
            title={isExpanded ? 'Reducir ancho del panel' : 'Ampliar ancho del panel'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700 cursor-pointer"
            title="Cerrar panel de Estudio Web"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Navigation Tabs: Gemini Web | Google Flow | Setup */}
      <div className="px-3 pt-2 bg-[#14120e] border-b border-slate-800 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('gemini')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer border-b-2 transition ${
              activeTab === 'gemini'
                ? 'bg-amber-500/15 text-amber-300 border-amber-400'
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            1. Gemini Web (Texto + Nano Banana 2.1)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('flow')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer border-b-2 transition ${
              activeTab === 'flow'
                ? 'bg-purple-500/15 text-purple-300 border-purple-400'
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            2. Google Flow (Imágenes y Clips Video)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('setup')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer border-b-2 transition ${
              activeTab === 'setup'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400'
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            ⚙️ Conectar Extensión {!extensionInstalled && '(!)'}
          </button>
        </div>

        {/* Refresh or Dock Window Controls */}
        <div className="flex items-center gap-1 pb-1">
          {activeTab === 'gemini' && (
            <>
              <button
                type="button"
                onClick={() => setIframeKeyGemini((k) => k + 1)}
                className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
                title="Recargar Gemini incrustado"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() =>
                  sendCommandToWebBridge('GEMINI', {
                    action: 'OPEN_DOCKED',
                    preferDockedWindow: true,
                    focusTab: true,
                  })
                }
                className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-amber-300 border border-amber-500/30 flex items-center gap-1 cursor-pointer"
                title="Si Google pide login fuera del iframe, abre Gemini en ventana acoplada lateral 100% conectada"
              >
                <ExternalLink className="w-3 h-3" /> Ventana Acoplada
              </button>
            </>
          )}
          {activeTab === 'flow' && (
            <>
              <button
                type="button"
                onClick={() => setIframeKeyFlow((k) => k + 1)}
                className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
                title="Recargar Google Flow incrustado"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() =>
                  sendCommandToWebBridge('FLOW', {
                    action: 'OPEN_DOCKED',
                    preferDockedWindow: true,
                    focusTab: true,
                  })
                }
                className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-purple-300 border border-purple-500/30 flex items-center gap-1 cursor-pointer"
                title="Abrir Google Flow en ventana acoplada lateral 100% conectada"
              >
                <ExternalLink className="w-3 h-3" /> Ventana Acoplada
              </button>
            </>
          )}
        </div>
      </div>

      {/* Action Bridge Bar for Current Stage */}
      {activeTab === 'gemini' && (
        <div className="p-2.5 bg-slate-950/90 border-b border-slate-800 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-slate-300">
              Etapa Activa: <strong className="text-amber-300">{stageTitle}</strong>
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={onSendStagePromptToGeminiWeb}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow"
                title="Envía automáticamente el prompt de esta etapa a tu Gemini Web, presiona Enviar y guarda la respuesta al terminar"
              >
                <Wand2 className="w-3.5 h-3.5" />
                🚀 Autogenerar Etapa {activeStage} en Gemini Web
              </button>
              <button
                type="button"
                onClick={onGrabLastGeminiResponse}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold text-xs flex items-center gap-1 cursor-pointer"
                title="Trae la última respuesta escrita por Gemini Web y la guarda directamente en esta etapa"
              >
                <Download className="w-3.5 h-3.5" />
                📥 Traer Última Respuesta
              </button>
            </div>
          </div>

          {bridgeStatusMsg && (
            <div
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-2 border ${
                bridgeStatusType === 'ERROR'
                  ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
                  : bridgeStatusType === 'SUCCESS'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                  : 'bg-amber-950/50 border-amber-500/40 text-amber-200'
              }`}
            >
              {bridgeStatusType === 'SUCCESS' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : bridgeStatusType === 'ERROR' ? (
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
              )}
              <span className="truncate">{bridgeStatusMsg}</span>
            </div>
          )}
        </div>
      )}

      {activeTab === 'flow' && (
        <div className="p-2.5 bg-slate-950/90 border-b border-slate-800 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={quickFlowPrompt}
              onChange={(e) => setQuickFlowPrompt(e.target.value)}
              placeholder="Pega o envía cualquier prompt de Imagen o Clip desde Etapa 5, 6 u 8 hacia Google Flow..."
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono"
            />
            <button
              type="button"
              onClick={() => {
                if (!quickFlowPrompt.trim()) return;
                onSendCustomPromptToFlow(quickFlowPrompt.trim());
              }}
              className="px-3 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-400 text-slate-950 font-black text-xs flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Film className="w-3.5 h-3.5" /> Enviar a Flow
            </button>
          </div>
          {bridgeStatusMsg && (
            <div className="px-3 py-1 rounded-lg bg-purple-950/50 border border-purple-500/30 text-[11px] text-purple-200 font-semibold truncate">
              {bridgeStatusMsg}
            </div>
          )}
        </div>
      )}

      {/* Main Content Area: Persistent Iframes + Setup Instructions */}
      <div className="flex-1 relative bg-black overflow-hidden">
        {/* GEMINI WEB IFRAME */}
        <iframe
          key={`gemini-frame-${iframeKeyGemini}`}
          src="https://gemini.google.com/app"
          title="Gemini Web Embedded"
          className="w-full h-full border-0"
          style={{ display: activeTab === 'gemini' ? 'block' : 'none' }}
          allow="clipboard-read; clipboard-write; microphone"
        />

        {/* GOOGLE FLOW IFRAME */}
        <iframe
          key={`flow-frame-${iframeKeyFlow}`}
          src="https://labs.google/fx/tools/flow"
          title="Google Flow Embedded"
          className="w-full h-full border-0"
          style={{ display: activeTab === 'flow' ? 'block' : 'none' }}
          allow="clipboard-read; clipboard-write"
        />

        {/* SETUP & INSTRUCTIONS TAB */}
        {activeTab === 'setup' && (
          <div className="w-full h-full overflow-y-auto p-6 bg-[#12100d] text-slate-200 space-y-5 select-text">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-2">
              <h4 className="text-sm font-black text-amber-300 flex items-center gap-2">
                ⚡ Cómo activar la Extensión Puente en Chrome (1 sola vez, toma 10 segundos)
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                Para que tu navegador permita ver <strong>Gemini Web</strong> y <strong>Google Flow</strong>{' '}
                incrustados aquí mismo y que <strong>Huellas Master</strong> escriba los prompts y recoja las
                respuestas automáticamente usando tu cuenta gratis:
              </p>
            </div>

            <ol className="space-y-4 text-xs text-slate-300">
              <li className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="font-bold text-amber-300">
                  Paso 1: Abre la página de Extensiones de Chrome
                </div>
                <p className="text-slate-400">
                  Copia y pega <code className="text-amber-200">chrome://extensions</code> en una nueva pestaña
                  de Chrome y activa el interruptor <strong>&quot;Modo de desarrollador&quot;</strong> (arriba a la
                  derecha).
                </p>
                <button
                  type="button"
                  onClick={handleCopyChromeExtensionsUrl}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer border border-amber-500/30"
                >
                  {copiedExtUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedExtUrl ? '¡Copiado! Pégalo en la barra de Chrome' : '📋 Copiar chrome://extensions'}
                </button>
              </li>

              <li className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="font-bold text-amber-300">
                  Paso 2: Haz clic en &quot;Cargar descomprimida&quot; (Load unpacked)
                </div>
                <p className="text-slate-400">
                  Selecciona la carpeta <code className="text-emerald-300">chrome-extension</code> que ya creamos
                  dentro de tu proyecto <strong>Huellas Master</strong>:
                </p>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg p-2 font-mono text-[11px] text-emerald-300 break-all">
                  <span className="flex-1">{CHROME_EXTENSION_FOLDER_PATH}</span>
                  <button
                    type="button"
                    onClick={handleCopyFolderPath}
                    className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-bold text-xs shrink-0 cursor-pointer flex items-center gap-1"
                  >
                    {copiedPath ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedPath ? 'Copiada' : 'Copiar Ruta'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  💡 <em>Tip en Mac:</em> Cuando se abra la ventana para elegir carpeta en Chrome, presiona{' '}
                  <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-200">Cmd + Shift + G</kbd>, pega
                  la ruta copiada arriba y presiona <strong>Enter</strong>.
                </p>
              </li>

              <li className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="font-bold text-amber-300">
                  Paso 3: ¡Listo! Recarga esta página o presiona Verificar
                </div>
                <p className="text-slate-400">
                  Una vez cargada la extensión, recarga esta página y verás el indicador en verde{' '}
                  <strong className="text-emerald-300">&quot;Puente Activo&quot;</strong>. Si Chrome bloquea las
                  cookies de sesión de Google dentro del recuadro incrustado, también puedes usar el botón{' '}
                  <strong className="text-amber-300">&quot;Ventana Acoplada&quot;</strong> arriba a la derecha y
                  Huellas Master la controlará de forma 100% automática.
                </p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer"
                >
                  🔄 Recargar Página y Conectar Puente
                </button>
              </li>
            </ol>
          </div>
        )}
      </div>
    </aside>
  );
};
