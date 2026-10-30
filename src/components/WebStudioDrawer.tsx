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
  Columns,
  Send,
} from 'lucide-react';
import {
  CHROME_EXTENSION_FOLDER_PATH,
  ConnectedAiTab,
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
  onChangeAiEngineMode: (mode: 'WEB_FREE' | 'API_KEY') => void;
  onSendCurrentStageToGemini: (targetTabId?: number) => void;
  onGrabLastGeminiResponse: (targetTabId?: number) => void;
  onSendCustomPromptToFlow: (prompt: string, targetTabId?: number) => void;
  geminiTabs: ConnectedAiTab[];
  flowTabs: ConnectedAiTab[];
  selectedGeminiTabId?: number;
  onSelectGeminiTabId: (id?: number) => void;
  selectedFlowTabId?: number;
  onSelectFlowTabId: (id?: number) => void;
  lastMirroredGeminiText: string;
  lastMirroredGeminiImages: string[];
  lastMirroredFlowVideos: string[];
  lastMirroredFlowImages: string[];
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
  onChangeAiEngineMode,
  onSendCurrentStageToGemini,
  onGrabLastGeminiResponse,
  onSendCustomPromptToFlow,
  geminiTabs,
  flowTabs,
  selectedGeminiTabId,
  onSelectGeminiTabId,
  selectedFlowTabId,
  onSelectFlowTabId,
  lastMirroredGeminiText,
  lastMirroredGeminiImages,
  lastMirroredFlowVideos,
  lastMirroredFlowImages,
}) => {
  const [activeTab, setActiveTab] = useState<'gemini' | 'flow' | 'setup'>('gemini');
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedExtUrl, setCopiedExtUrl] = useState(false);
  const [quickGeminiPrompt, setQuickGeminiPrompt] = useState('');
  const [quickFlowPrompt, setQuickFlowPrompt] = useState('');

  if (!isOpen) return null;

  const activeGeminiTab =
    geminiTabs.find((t) => t.id === selectedGeminiTabId) || geminiTabs[0] || null;
  const activeFlowTab =
    flowTabs.find((t) => t.id === selectedFlowTabId) || flowTabs[0] || null;

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
        isExpanded ? 'w-full lg:w-[58%]' : 'w-full lg:w-[44%]'
      } border-l border-amber-500/30 bg-[#110f0c] flex flex-col shrink-0 transition-all duration-200 select-none`}
      style={{ height: 'calc(100vh - 57px)' }}
    >
      {/* Top Header of Embedded Studio */}
      <div className="p-3 bg-[#17140f] border-b border-slate-800 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <Globe className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-300">
                Estudio Web Gratis (Gemini &amp; Google Flow)
              </h3>
              <button
                type="button"
                onClick={() => {
                  pingHuellasExtension();
                  if (!extensionInstalled) setActiveTab('setup');
                }}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 border cursor-pointer ${
                  extensionInstalled
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    extensionInstalled ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                  }`}
                />
                {extensionInstalled ? 'Puente Activo' : 'Conectar Extensión'}
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              Controla tus pestañas abiertas de Gemini y Google Flow sin gastar API Key
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Switch default engine mode */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-[10px] font-bold">
            <button
              type="button"
              onClick={() => onChangeAiEngineMode('WEB_FREE')}
              className={`px-2 py-1 rounded-md cursor-pointer transition ${
                aiEngineMode === 'WEB_FREE'
                  ? 'bg-emerald-500 text-slate-950 font-black'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Los botones 'Generar con Gemini' usarán tu pestaña de Gemini Web gratis sin gastar API Key"
            >
              🌐 Cuota Web Gratis
            </button>
            <button
              type="button"
              onClick={() => onChangeAiEngineMode('API_KEY')}
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
            {isExpanded ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
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
            1. Gemini Web ({geminiTabs.length})
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
            2. Google Flow ({flowTabs.length})
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
            ⚙️ Extensión
          </button>
        </div>

        {/* Refresh & Switch Tab in Same Window Controls */}
        <div className="flex items-center gap-1 pb-1">
          <button
            type="button"
            onClick={() => pingHuellasExtension()}
            className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
            title="Actualizar pestañas de Gemini y Google Flow abiertas en esta misma ventana"
          >
            <RefreshCw className="w-3 h-3" /> Actualizar Pestañas
          </button>
          <button
            type="button"
            onClick={() =>
              sendCommandToWebBridge(activeTab === 'flow' ? 'FLOW' : 'GEMINI', {
                action: 'FOCUS_TAB',
                tabId: activeTab === 'flow' ? activeFlowTab?.id : activeGeminiTab?.id,
              })
            }
            className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-amber-300 border border-amber-500/30 flex items-center gap-1 cursor-pointer"
            title="Cambiar a la pestaña de Gemini / Google Flow en esta misma ventana"
          >
            <ExternalLink className="w-3 h-3" /> Ir a la Pestaña (Misma Ventana)
          </button>
        </div>
      </div>

      {/* Status Banner */}
      {bridgeStatusMsg && (
        <div
          className={`mx-3 mt-2.5 px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
            bridgeStatusType === 'ERROR'
              ? 'bg-rose-950/70 border-rose-500/40 text-rose-200'
              : bridgeStatusType === 'SUCCESS'
              ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-200'
              : 'bg-amber-950/60 border-amber-500/40 text-amber-200'
          }`}
        >
          {bridgeStatusType === 'SUCCESS' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : bridgeStatusType === 'ERROR' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
          )}
          <span className="flex-1 leading-snug">{bridgeStatusMsg}</span>
        </div>
      )}

      {/* =====================================================================
          TAB 1: GEMINI WEB LIVE CONSOLE & MIRROR
      ===================================================================== */}
      {activeTab === 'gemini' && (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4 select-text">
          {/* Connected Gemini Chat Selector */}
          <div className="bg-[#16130f] border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    activeGeminiTab ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                  }`}
                />
                Pestaña de Gemini en esta Ventana:
              </span>
              <span className="text-[10px] text-slate-400">
                {geminiTabs.length > 0
                  ? `${geminiTabs.length} en esta ventana`
                  : 'Se abrirá una pestaña en esta misma ventana'}
              </span>
            </div>

            {geminiTabs.length > 0 ? (
              <select
                value={activeGeminiTab?.id || ''}
                onChange={(e) => onSelectGeminiTabId(Number(e.target.value))}
                className="w-full bg-slate-950 border border-emerald-500/40 rounded-lg px-3 py-2 text-xs font-bold text-emerald-300"
              >
                {geminiTabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    🟢 {t.title} ({t.url.replace('https://gemini.google.com/', '')})
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                No hay pestañas de Gemini abiertas aún. Al hacer clic en <strong>Autogenerar</strong> se abrirá{' '}
                <code className="text-amber-300">gemini.google.com</code> automáticamente.
              </div>
            )}
          </div>

          {/* Stage Automation Box */}
          <div className="bg-[#16130f] border border-amber-500/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Automatización de Etapa Activa
                </div>
                <div className="text-sm font-black text-amber-300">{stageTitle}</div>
              </div>
              <span className="text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                100% Gratis (Sin API Key)
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Presiona el botón amarillo para que <strong>Huellas Master</strong> escriba el prompt de esta
              etapa en tu chat de Gemini (<strong className="text-emerald-300">{activeGeminiTab?.title || 'Gemini Web'}</strong>),
              lo envíe, espere a que termine de redactar y <strong>llene automáticamente los campos de esta etapa</strong>.
            </p>

            <div className="flex items-center gap-2 flex-wrap pt-1">
              <button
                type="button"
                onClick={() => onSendCurrentStageToGemini(activeGeminiTab?.id)}
                className="flex-1 min-w-[210px] py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-amber-500/20"
              >
                <Wand2 className="w-4 h-4" />
                🚀 Autogenerar Etapa {activeStage} en Gemini Web
              </button>

              <button
                type="button"
                onClick={() => onGrabLastGeminiResponse(activeGeminiTab?.id)}
                className="py-2.5 px-3.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                title="Extrae inmediatamente la última respuesta que esté en tu chat de Gemini y la guarda en esta etapa"
              >
                <Download className="w-4 h-4" />
                📥 Traer Última Respuesta Ahora
              </button>
            </div>
          </div>

          {/* Direct Free-Form Prompt to Gemini Web */}
          <div className="bg-[#16130f] border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <label className="text-xs font-bold text-slate-300 block">
              💬 Enviar instrucción o prompt libre a tu chat de Gemini Web:
            </label>
            <div className="flex gap-2">
              <textarea
                rows={2}
                value={quickGeminiPrompt}
                onChange={(e) => setQuickGeminiPrompt(e.target.value)}
                placeholder="Escribe cualquier instrucción adicional para tu chat de Gemini y presiona Enviar..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
              />
              <button
                type="button"
                onClick={() => {
                  if (!quickGeminiPrompt.trim()) return;
                  sendCommandToWebBridge('GEMINI', {
                    action: 'SEND_PROMPT',
                    prompt: quickGeminiPrompt.trim(),
                    stageNumber: activeStage,
                    taskType: 'CUSTOM_PROMPT',
                    autoSubmit: true,
                    tabId: activeGeminiTab?.id,
                  });
                  setQuickGeminiPrompt('');
                }}
                className="px-3.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Send className="w-3.5 h-3.5" /> Enviar
              </button>
            </div>
          </div>

          {/* Live Response Mirror from Gemini Web */}
          <div className="bg-[#16130f] border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Espejo en Vivo — Última Respuesta Recibida de Gemini Web
              </span>
              {lastMirroredGeminiText && (
                <span className="text-[10px] text-emerald-400 font-mono">
                  {lastMirroredGeminiText.length} caracteres
                </span>
              )}
            </div>

            {lastMirroredGeminiImages.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {lastMirroredGeminiImages.map((imgUrl, i) => (
                  <img
                    key={i}
                    src={imgUrl}
                    alt={`Gemini Generated ${i + 1}`}
                    className="w-full rounded-lg border border-amber-500/30 object-cover"
                  />
                ))}
              </div>
            )}

            <div className="bg-slate-950 border border-slate-800/90 rounded-lg p-3 max-h-[320px] overflow-y-auto text-xs font-mono text-slate-200 whitespace-pre-wrap leading-relaxed">
              {lastMirroredGeminiText ||
                'Aquí verás en tiempo real el texto e imágenes que responda tu pestaña de Gemini Web...'}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: GOOGLE FLOW LIVE CONSOLE & MIRROR
      ===================================================================== */}
      {activeTab === 'flow' && (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4 select-text">
          {/* Connected Google Flow Project Selector */}
          <div className="bg-[#16130f] border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    activeFlowTab ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                  }`}
                />
                Pestaña de Google Flow en esta Ventana:
              </span>
              <span className="text-[10px] text-slate-400">
                {flowTabs.length > 0
                  ? `${flowTabs.length} en esta ventana`
                  : 'Se abrirá una pestaña en esta misma ventana'}
              </span>
            </div>

            {flowTabs.length > 0 ? (
              <select
                value={activeFlowTab?.id || ''}
                onChange={(e) => onSelectFlowTabId(Number(e.target.value))}
                className="w-full bg-slate-950 border border-purple-500/40 rounded-lg px-3 py-2 text-xs font-bold text-purple-300"
              >
                {flowTabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    🟢 {t.title}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                No hay pestañas de Google Flow abiertas. Al enviar cualquier imagen o clip se abrirá{' '}
                <code className="text-purple-300">flow.google.com</code> automáticamente.
              </div>
            )}
          </div>

          {/* Direct Prompt Injector to Google Flow */}
          <div className="bg-[#16130f] border border-purple-500/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-purple-300">
                🎬 Enviar Prompt de Imagen o Video a Google Flow
              </span>
              <button
                type="button"
                onClick={() =>
                  sendCommandToWebBridge('FLOW', {
                    action: 'GRAB_LAST_MEDIA',
                    tabId: activeFlowTab?.id,
                  })
                }
                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold cursor-pointer flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> Traer Media de Flow
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              En las etapas <strong>5 (Miniatura)</strong>, <strong>6 (@Referencias)</strong> y{' '}
              <strong>8 (Clips)</strong> tienes botones directos (<strong>🚀 Flow Imagen</strong> y{' '}
              <strong>🎬 Flow Video</strong>) en cada tarjeta. También puedes pegar o escribir un prompt aquí:
            </p>

            <textarea
              rows={4}
              value={quickFlowPrompt}
              onChange={(e) => setQuickFlowPrompt(e.target.value)}
              placeholder="Pega aquí un prompt en inglés para generar imagen o clip en Google Flow..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-200"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!quickFlowPrompt.trim()) return;
                  onSendCustomPromptToFlow(quickFlowPrompt.trim(), activeFlowTab?.id);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-purple-500 hover:bg-purple-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-purple-500/20"
              >
                <Film className="w-4 h-4" /> 🚀 Inyectar y Generar en Google Flow
              </button>
              <button
                type="button"
                onClick={() =>
                  sendCommandToWebBridge('FLOW', {
                    action: 'FOCUS_TAB',
                    tabId: activeFlowTab?.id,
                  })
                }
                className="py-2.5 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink className="w-4 h-4" /> Ir a Pestaña Flow
              </button>
            </div>
          </div>

          {/* Captured Flow Media Preview */}
          {(lastMirroredFlowVideos.length > 0 || lastMirroredFlowImages.length > 0) && (
            <div className="bg-[#16130f] border border-slate-800 rounded-xl p-3.5 space-y-2.5">
              <span className="text-xs font-bold text-purple-300 block">
                📥 Media Reciente Detectada en Google Flow:
              </span>
              <div className="grid grid-cols-2 gap-2">
                {lastMirroredFlowVideos.slice(0, 4).map((vUrl, idx) => (
                  <video
                    key={`v-${idx}`}
                    src={vUrl}
                    controls
                    className="w-full rounded-lg border border-purple-500/30"
                  />
                ))}
                {lastMirroredFlowImages.slice(0, 4).map((iUrl, idx) => (
                  <img
                    key={`i-${idx}`}
                    src={iUrl}
                    alt={`Flow Media ${idx + 1}`}
                    className="w-full rounded-lg border border-amber-500/30 object-cover"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 3: SETUP & UPDATE EXTENSION
      ===================================================================== */}
      {activeTab === 'setup' && (
        <div className="flex-1 overflow-y-auto p-5 bg-[#12100d] text-slate-200 space-y-4 select-text">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 space-y-2">
            <h4 className="text-sm font-black text-emerald-300">
              🔌 Estado del Puente de Chrome: {extensionInstalled ? '🟢 CONECTADO' : '🟡 PENDIENTE'}
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              Por seguridad de Google, <code>gemini.google.com</code> y <code>flow.google.com</code> bloquean
              el inicio de sesión dentro de recuadros <code>&lt;iframe&gt;</code> externos. Por eso, este{' '}
              <strong>Puente Inteligente</strong> se conecta directamente a tus pestañas reales ya abiertas en
              Chrome (o las acopla 50/50 lado a lado en tu pantalla).
            </p>
          </div>

          <ol className="space-y-3 text-xs text-slate-300">
            <li className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2">
              <div className="font-bold text-amber-300">1. Carpeta de la Extensión en tu Mac</div>
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg p-2 font-mono text-[11px] text-emerald-300 break-all">
                <span className="flex-1">{CHROME_EXTENSION_FOLDER_PATH}</span>
                <button
                  type="button"
                  onClick={handleCopyFolderPath}
                  className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-bold text-xs shrink-0 cursor-pointer flex items-center gap-1"
                >
                  {copiedPath ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedPath ? 'Copiada' : 'Copiar'}
                </button>
              </div>
            </li>

            <li className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2">
              <div className="font-bold text-amber-300">
                2. Actualizar o Cargar en <code>chrome://extensions</code>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyChromeExtensionsUrl}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer border border-amber-500/30"
                >
                  {copiedExtUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedExtUrl ? '¡Copiado!' : '📋 Copiar chrome://extensions'}
                </button>
                <button
                  type="button"
                  onClick={() => pingHuellasExtension()}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer"
                >
                  🔄 Verificar Conexión Ahora
                </button>
              </div>
            </li>
          </ol>
        </div>
      )}
    </aside>
  );
};
