/** @odoo-module **/

// 1. Imports
import { _t } from "@web/core/l10n/translation";
import { browser } from "@web/core/browser/browser";
import { registry } from "@web/core/registry";
import { KeepLast } from "@web/core/utils/concurrency";
import { useService } from "@web/core/utils/hooks";
import { View, ViewNotFoundError } from "@web/views/view";
import { ControlPanel } from "@web/search/control_panel/control_panel";
import {
    Component,
    markup,
    onMounted,
    useChildSubEnv,
    xml,
    reactive,
} from "@odoo/owl";

// 2. Type definitions and registries
/** @typedef {string} ViewType */
const actionHandlersRegistry = registry.category("action_handlers");
const actionRegistry = registry.category("actions");
const viewRegistry = registry.category("views");

// 3. Component definitions
class BlankComponent extends Component {
    static props = ["onMounted", "withControlPanel", "*"];
    static template = xml`
        <ControlPanel display="{disableDropdown: true}" t-if="props.withControlPanel and !env.isSmall">
            <t t-set-slot="layout-buttons">
                <button class="btn btn-primary invisible"> empty </button>
            </t>
        </ControlPanel>`;
    static components = { ControlPanel };

    setup() {
        useChildSubEnv({ config: { breadcrumbs: [], noBreadcrumbs: true } });
        onMounted(() => this.props.onMounted());
    }
}

// 4. Helper functions
/**
 * @private
 * @param {string} viewType
 * @throws {Error} if the current controller is not a view
 * @returns {View | null}
 */
function _getView(viewType) {
    const currentController = controllerStack[controllerStack.length - 1];
    if (currentController.action.type !== "ir.actions.act_window") {
        throw new Error(`switchView called but the current controller isn't a view`);
    }
    const view = currentController.views.find((view) => view.type === viewType);
    return view || null;
}

/**
 * @private
 * @param {Array} views an array of views
 * @param {boolean} multiRecord true if we search for a multiRecord view
 * @param {string} viewType type of the view to search
 * @returns {Object|undefined} the requested view if it could be found
 */
function _findView(views, multiRecord, viewType) {
    return views.find((v) => v.type === viewType && v.multiRecord == multiRecord);
}


/**
 * @returns {Promise<{actionRequest: Object, options: Object} | null>}
 */
async function _getViewPreference(env, model, actionId) {
    try {
        // 1. Check session storage first (faster)
        const sessionKey = `view_pref_${env.services.user.userId}_${model}_${actionId}`;
        const storedPref = browser.sessionStorage.getItem(sessionKey);
        
        if (storedPref) {
            const preference = JSON.parse(storedPref);
            // Normalize view type
            preference.view_type = ViewTypeUtils.normalizeViewType(preference.view_type);
            console.log("[ViewPreference] Found in session storage:", preference);
            return preference;
        }

        // 2. If not in session, check database
        const prefs = await env.services.orm.searchRead(
            'last.view.preference',
            [
                ['user_id', '=', env.services.user.userId],
                ['model_name', '=', model],
                ['action_id', '=', actionId]
            ],
            ['view_type', 'action_id', 'action_name'],
            { limit: 1, order: 'write_date DESC' }
        );

        if (prefs?.length) {
            const dbPref = {
                model_name: model,
                view_type: ViewTypeUtils.normalizeViewType(prefs[0].view_type),
                action_id: prefs[0].action_id,
                action_name: prefs[0].action_name,
                timestamp: new Date().toISOString()
            };

            // Save normalized preference to session storage
            browser.sessionStorage.setItem(sessionKey, JSON.stringify(dbPref));
            console.log("[ViewPreference] Found in database:", dbPref);
            return dbPref;
        }

        return null;
    } catch (error) {
        console.warn("[ViewPreference] Error getting preference:", error);
        return null;
    }
}

/**
 * @returns {Promise<{actionRequest: Object, options: Object} | null>}
 */
async function _getActionParams() {
    const state = env.services.router.current.hash;
    const options = { clearBreadcrumbs: true };
    let actionRequest = null;

    if (state.action) {
        const context = {};
        if (state.active_id) {
            context.active_id = state.active_id;
        }
        if (state.active_ids) {
            context.active_ids = parseActiveIds(state.active_ids);
        } else if (state.active_id) {
            context.active_ids = [state.active_id];
        }
        // ClientAction
        if (actionRegistry.contains(state.action)) {
            actionRequest = {
                context,
                params: state,
                tag: state.action,
                type: "ir.actions.client",
            };
        } else {
            // Use doAction directly for non-client actions
            return { 
                actionRequest: state.action, 
                options: {
                    ...options,
                    additionalContext: context,
                    viewType: state.view_type,
                    props: state.id ? { resId: state.id } : undefined
                }
            };
        }
    } else if (state.model) {
        if (state.id) {
            // Form view for specific record
            actionRequest = {
                res_model: state.model,
                res_id: state.id,
                type: "ir.actions.act_window",
                views: [[state.view_id ? state.view_id : false, "form"]],
            };
        } else if (state.view_type) {
            // Try to get preference
            const preference = await _getViewPreference(env, state.model, state.action);
            
            if (preference?.view_type) {
                actionRequest = {
                    type: "ir.actions.act_window",
                    res_model: state.model,
                    views: [[false, preference.view_type]],
                    view_type: preference.view_type,
                    action_id: preference.action_id,
                    name: preference.action_name
                };
                options.viewType = preference.view_type;
                
                console.log("[ViewPreference] Using preferred view:", {
                    model: state.model,
                    view: preference.view_type,
                    action: preference.action_id,
                    name: preference.action_name
                });
            } else {
                // Fallback to default view type
                actionRequest = {
                    type: "ir.actions.act_window",
                    res_model: state.model,
                    views: [[false, state.view_type]],
                };
                options.viewType = state.view_type;
            }
        }
    }

    if (!actionRequest && env.services.user.home_action_id) {
        actionRequest = env.services.user.home_action_id;
    }

    return actionRequest ? { actionRequest, options } : null;
}

/**
 * @returns {SwitchViewParams | null}
 */
function _getSwitchViewParams() {
    const state = env.services.router.current.hash;
    if (state.action && !actionRegistry.contains(state.action)) {
        const currentController = controllerStack[controllerStack.length - 1];
        const currentActionId = currentController?.action?.id;
        if (
            currentController &&
            currentController.action.type === "ir.actions.act_window" &&
            currentActionId === state.action
        ) {
            const props = { resId: state.id || false };
            const viewType = state.view_type || currentController.view.type;
            return { viewType, props };
        }
    }
    return null;
}

// 5. Core functions
async function switchView(viewType, props = {}) {
    await keepLast.add(Promise.resolve());
    if (dialog) {
        return;
    }
    const controller = controllerStack[controllerStack.length - 1];
    const view = _getView(viewType);
    if (!view) {
        throw new ViewNotFoundError(
            _t("No view of type '%s' could be found in the current action.", viewType)
        );
    }
    const newController = controller.action.controllers[viewType] || {
        jsId: `controller_${++id}`,
        Component: View,
        action: controller.action,
        views: controller.views,
        view,
    };

    const canProceed = await clearUncommittedChanges(env);
    if (!canProceed) {
        return;
    }

    Object.assign(
        newController,
        _getViewInfo(view, controller.action, controller.views, props)
    );
    controller.action.controllers[viewType] = newController;
    let index;
    if (view.multiRecord) {
        index = controllerStack.findIndex((ct) => ct.action.jsId === controller.action.jsId);
        index = index > -1 ? index : controllerStack.length - 1;
    } else {
        index = controllerStack.findIndex(
            (ct) => ct.action.jsId === controller.action.jsId && !ct.view.multiRecord
        );
        index = index > -1 ? index : controllerStack.length;
    }
    return _updateUI(newController, { index });
}

async function loadState() {
    console.log('[ViewPreference] 🔄 Loading state...');
    
    try {
        const switchViewParams = _getSwitchViewParams();
        if (switchViewParams) {
            const { viewType, props } = switchViewParams;
            const view = _getView(viewType);
            if (view) {
                await switchView(viewType, props);
                return true;
            }
        }

        const actionParams = await _getActionParams();
        if (actionParams) {
            const { actionRequest, options } = actionParams;
            
            // Check for view preference before executing action
            if (actionRequest.res_model) {
                const preference = await _getViewPreference(
                    env, 
                    actionRequest.res_model, 
                    actionRequest.id || actionRequest.action_id
                );

                if (preference?.view_type) {
                    const normalizedViewType = ViewTypeUtils.normalizeViewType(preference.view_type);
                    
                    // Force view configuration
                    actionRequest.view_mode = normalizedViewType;
                    actionRequest.views = actionRequest.views || [];
                    
                    // Reorder views array
                    const preferredView = actionRequest.views.find(v => 
                        v[1] === normalizedViewType || 
                        (normalizedViewType === 'list' && v[1] === 'tree')
                    );
                    
                    if (preferredView) {
                        actionRequest.views = [
                            preferredView,
                            ...actionRequest.views.filter(v => v !== preferredView)
                        ];
                    }
                    
                    // Force context
                    actionRequest.context = {
                        ...(actionRequest.context || {}),
                        view_type: normalizedViewType,
                        force_view_type: normalizedViewType
                    };
                    
                    // Update options
                    options.viewType = normalizedViewType;
                    
                    console.log('[ViewPreference] 📊 Applied preference in loadState:', {
                        model: actionRequest.res_model,
                        view_type: normalizedViewType,
                        views: actionRequest.views?.map(v => v[1])
                    });
                }
            }
            
            await doAction(actionRequest, options);
            return true;
        }
        return false;
    } catch (error) {
        console.error('[ViewPreference] ❌ Error in loadState:', error);
        return false;
    }
}

// 6. State management
function pushState(controller) {
    console.log('[ViewPreference] 📌 Pushing state...');
    
    try {
        const newState = {};
        const action = controller.action;
        
        if (action.id) {
            newState.action = action.id;
        } else if (action.type === "ir.actions.client") {
            newState.action = action.tag;
        }
        
        if (action.context) {
            const activeId = action.context.active_id;
            if (activeId) {
                newState.active_id = activeId;
            }
            const activeIds = action.context.active_ids;
            if (activeIds && !(activeIds.length === 1 && activeIds[0] === activeId)) {
                newState.active_ids = activeIds.join(",");
            }
        }
        
        if (action.type === "ir.actions.act_window") {
            // Get current view type from controller
            const currentViewType = controller.view?.type || action.view_type;
            
            newState.model = action.res_model;
            newState.view_type = currentViewType;
            newState.id = controller.props?.resId || 
                         (controller.props?.state && controller.props.state.resId) || 
                         undefined;
            
            // Save view preference when pushing state
            if (currentViewType && action.res_model) {
                _saveViewPreference(
                    env,
                    action.res_model,
                    currentViewType,
                    action.id,
                    action.display_name || action.name
                ).catch(error => {
                    console.warn('[ViewPreference] Error saving preference in pushState:', error);
                });
            }
        }
        
        console.log('[ViewPreference] 🔄 New state:', newState);
        env.services.router.pushState(newState, { replace: true });
    } catch (error) {
        console.error('[ViewPreference] ❌ Error in pushState:', error);
        env.services.router.pushState({}, { replace: true });
    }
}

/**
 * @private
 * Handle action execution with view preference
 */
async function doAction(actionRequest, options = {}) {
    if (options.skipPreference) {
        return env.services.action.doAction(actionRequest, options);
    }

    try {
        if (actionRequest.type === 'ir.actions.act_window') {
            const preference = await _getViewPreference(
                env, 
                actionRequest.res_model, 
                actionRequest.id || actionRequest.action_id
            );

            if (preference?.view_type) {
                // Normalize current views
                const currentViews = ViewTypeUtils.denormalizeViews(actionRequest.views || []);
                
                const action = {
                    ...actionRequest,
                    views: [
                        [false, preference.view_type],
                        ...currentViews.filter(v => v[1] !== preference.view_type)
                    ],
                    view_type: preference.view_type,
                };

                console.log("[ViewPreference] Applying view preference:", {
                    model: action.res_model,
                    view: preference.view_type,
                    action: action.id
                });

                return env.services.action.doAction(action, {
                    ...options,
                    skipPreference: true
                });
            }
        }

        return env.services.action.doAction(actionRequest, options);
    } catch (error) {
        console.warn("[ViewPreference] Error in doAction:", error);
        return env.services.action.doAction(actionRequest, options);
    }
}

// Tambahkan fungsi utility untuk save view preference
async function _saveViewPreference(env, model, viewType, actionId, actionName) {
    try {
        console.log('[ViewPreference] 📡 Saving view preference:', {
            model,
            viewType,
            actionId,
            actionName
        });

        const result = await env.services.orm.call(
            'last.view.preference',
            'save_last_view',
            [model, viewType, actionId, actionName]
        );

        if (result) {
            // Save to session storage
            const sessionKey = `view_pref_${env.services.user.userId}_${model}_${actionId}`;
            const sessionData = {
                model_name: model,
                view_type: viewType,
                action_id: actionId,
                action_name: actionName,
                timestamp: new Date().toISOString()
            };
            
            sessionStorage.setItem(sessionKey, JSON.stringify(sessionData));
            console.log('[ViewPreference] 💾 Saved to session storage:', sessionData);
        }

        return result;
    } catch (error) {
        console.error('[ViewPreference] ❌ Error saving preference:', error);
        return false;
    }
}

const lastViewPreferenceLoader = {
    dependencies: ["action", "orm", "user", "router"],
    start(env) {
        let isProcessing = false;

        // Fungsi untuk menerapkan preferensi ke action
        const applyPreferenceToAction = async (action) => {
            if (!action?.res_model) return action;

            try {
                const preference = await _getViewPreference(
                    env, 
                    action.res_model, 
                    action.id || action.action_id
                );

                if (preference?.view_type) {
                    // 1. Normalisasi view type dengan lebih ketat
                    const normalizedViewType = preference.view_type === 'tree' ? 'list' : preference.view_type;
                    
                    // 2. Konversi semua tree view ke list view terlebih dahulu
                    action.views = action.views.map(view => 
                        view[1] === 'tree' ? [view[0], 'list'] : view
                    );

                    // 3. Cari view yang diinginkan dengan lebih spesifik
                    const preferredViewIndex = action.views.findIndex(v => 
                        v[1] === normalizedViewType
                    );

                    if (preferredViewIndex !== -1) {
                        // 4. Pindahkan view yang dipilih ke posisi pertama
                        const [selectedView] = action.views.splice(preferredViewIndex, 1);
                        action.views = [selectedView, ...action.views];
                        
                        // 5. Update konfigurasi dengan lebih tegas
                        action.view_type = normalizedViewType;
                        action.view_mode = action.views.map(v => v[1]).join(',');
                        
                        // 6. Paksa context untuk list view
                        action.context = {
                            ...(action.context || {}),
                            view_type: normalizedViewType,
                            force_view_type: normalizedViewType,
                            initial_view: normalizedViewType
                        };

                        // 7. Hapus pengaturan view yang mungkin bertentangan
                        if (action.context?.default_view_type) {
                            delete action.context.default_view_type;
                        }
                        
                        console.log('[ViewPreference] 📊 Final action config:', {
                            view_type: action.view_type,
                            view_mode: action.view_mode,
                            views: action.views.map(v => `${v[1]}(${v[0]})`),
                            context: action.context
                        });
                    }
                }
            } catch (error) {
                console.warn('[ViewPreference] Error applying preference:', error);
            }
            
            return action;
        };

        // Patch loadAction untuk menangani navigasi awal
        const originalLoadAction = env.services.action.loadAction;
        env.services.action.loadAction = async function(actionRequest, context = {}) {
            const action = await originalLoadAction.call(this, actionRequest, context);
            if (action?.type === 'ir.actions.act_window') {
                return applyPreferenceToAction(action);
            }
            return action;
        };

        // Patch doAction untuk menangani navigasi
        const originalDoAction = env.services.action.doAction;
        env.services.action.doAction = async function(actionRequest, options = {}) {
            if (options.skipPreference) {
                return originalDoAction.call(this, actionRequest, options);
            }

            try {
                if (actionRequest.type === 'ir.actions.act_window') {
                    actionRequest = await applyPreferenceToAction(actionRequest);
                }
                return originalDoAction.call(this, actionRequest, {
                    ...options,
                    skipPreference: true
                });
            } catch (error) {
                console.warn('[ViewPreference] Error in doAction:', error);
                return originalDoAction.call(this, actionRequest, options);
            }
        };

        // Patch switchView untuk menangani perubahan view
        const originalSwitchView = env.services.action.switchView;
        env.services.action.switchView = async function(viewType, props = {}) {
            console.log('[ViewPreference] 🔄 Switching to view:', viewType);
            
            try {
                if (this.currentController?.action) {
                    const action = this.currentController.action;
                    const normalizedViewType = viewType === 'tree' ? 'list' : viewType;
                    
                    // Force reorder views
                    const viewIndex = action.views.findIndex(v => 
                        v[1] === normalizedViewType || 
                        (normalizedViewType === 'list' && v[1] === 'tree')
                    );
                    
                    if (viewIndex !== -1) {
                        const [selectedView] = action.views.splice(viewIndex, 1);
                        action.views = [selectedView, ...action.views];
                        action.view_mode = action.views.map(v => v[1]).join(',');
                        action.view_type = normalizedViewType;
                        
                        // Force context update
                        action.context = {
                            ...(action.context || {}),
                            view_type: normalizedViewType,
                            force_view_type: normalizedViewType,
                            initial_view: normalizedViewType
                        };

                        // Save preference immediately
                        await _saveViewPreference(
                            env,
                            action.res_model,
                            normalizedViewType,
                            action.id,
                            action.display_name || action.name
                        );
                    }
                }
                
                return originalSwitchView.call(this, viewType, props);
            } catch (error) {
                console.warn('[ViewPreference] Error in switchView:', error);
                return originalSwitchView.call(this, viewType, props);
            }
        };

        // Listen to navigation events
        env.bus.addEventListener('ACTION_MANAGER:UI-UPDATED', async () => {
            if (isProcessing) return;
            
            try {
                isProcessing = true;
                const controller = env.services.action.currentController;
                if (controller?.action?.type === 'ir.actions.act_window') {
                    await applyPreferenceToAction(controller.action);
                }
            } finally {
                isProcessing = false;
            }
        });

        return {
            loadState,
            switchView,
            _getView,
            _getSwitchViewParams,
            _findView,
            pushState,
            _saveViewPreference,
        };
    },
};

// Register service
registry.category("services").add("lastViewPreferenceLoader", lastViewPreferenceLoader); 