/** @odoo-module **/

// 1. Imports
import { _t } from "@web/core/l10n/translation";
import { browser } from "@web/core/browser/browser";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { View, ViewNotFoundError } from "@web/views/view";
import { ControlPanel } from "@web/search/control_panel/control_panel";
import {
    Component,
    onMounted,
    useChildSubEnv,
    xml,
    reactive,
} from "@odoo/owl";

// 2. Type definitions and registries
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
function _getView(viewType) {
    const currentController = controllerStack[controllerStack.length - 1];
    if (currentController.action.type !== "ir.actions.act_window") {
        throw new Error(`switchView called but the current controller isn't a view`);
    }
    const view = currentController.views.find((view) => view.type === viewType);
    return view || null;
}

async function _getViewPreference(env, model, actionId) {
    try {
        const sessionKey = `view_pref_${env.services.user.userId}_${model}_${actionId}`;
        const storedPref = browser.sessionStorage.getItem(sessionKey);
        
        if (storedPref) {
            return JSON.parse(storedPref);
        }

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
                view_type: prefs[0].view_type,
                action_id: prefs[0].action_id,
                action_name: prefs[0].action_name,
                timestamp: new Date().toISOString()
            };

            browser.sessionStorage.setItem(sessionKey, JSON.stringify(dbPref));
            return dbPref;
        }

        return null;
    } catch (error) {
        console.warn("[ViewPreference] Error getting preference:", error);
        return null;
    }
}

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
        if (actionRegistry.contains(state.action)) {
            actionRequest = {
                context,
                params: state,
                tag: state.action,
                type: "ir.actions.client",
            };
        } else {
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
            actionRequest = {
                res_model: state.model,
                res_id: state.id,
                type: "ir.actions.act_window",
                views: [[state.view_id ? state.view_id : false, "form"]],
            };
        } else if (state.view_type) {
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
            } else {
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

// 5. Core functions
async function switchView(viewType, props = {}) {
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
            
            if (actionRequest.res_model) {
                const preference = await _getViewPreference(
                    env, 
                    actionRequest.res_model, 
                    actionRequest.id || actionRequest.action_id
                );

                if (preference?.view_type) {
                    actionRequest.view_mode = preference.view_type;
                    actionRequest.views = actionRequest.views || [];
                    
                    const preferredView = actionRequest.views.find(v => 
                        v[1] === preference.view_type
                    );
                    
                    if (preferredView) {
                        actionRequest.views = [
                            preferredView,
                            ...actionRequest.views.filter(v => v !== preferredView)
                        ];
                    }
                    
                    actionRequest.context = {
                        ...(actionRequest.context || {}),
                        view_type: preference.view_type,
                        force_view_type: preference.view_type
                    };
                    
                    options.viewType = preference.view_type;
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
            const currentViewType = controller.view?.type || action.view_type;
            
            newState.model = action.res_model;
            newState.view_type = currentViewType;
            newState.id = controller.props?.resId || 
                         (controller.props?.state && controller.props.state.resId) || 
                         undefined;
            
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
        
        env.services.router.pushState(newState, { replace: true });
    } catch (error) {
        console.error('[ViewPreference] ❌ Error in pushState:', error);
        env.services.router.pushState({}, { replace: true });
    }
}

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
                const action = {
                    ...actionRequest,
                    views: [
                        [false, preference.view_type],
                        ...(actionRequest.views || []).filter(v => v[1] !== preference.view_type)
                    ],
                    view_type: preference.view_type,
                };

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

// Utility function to save view preference
async function _saveViewPreference(env, model, viewType, actionId, actionName) {
    try {
        const result = await env.services.orm.call(
            'last.view.preference',
            'save_last_view',
            [model, viewType, actionId, actionName]
        );

        if (result) {
            const sessionKey = `view_pref_${env.services.user.userId}_${model}_${actionId}`;
            const sessionData = {
                model_name: model,
                view_type: viewType,
                action_id: actionId,
                action_name: actionName,
                timestamp: new Date().toISOString()
            };
            
            sessionStorage.setItem(sessionKey, JSON.stringify(sessionData));
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

        const applyPreferenceToAction = async (action) => {
            if (!action?.res_model) return action;

            try {
                const preference = await _getViewPreference(
                    env, 
                    action.res_model, 
                    action.id || action.action_id
                );

                if (preference?.view_type) {
                    const preferredViewIndex = action.views.findIndex(v => 
                        v[1] === preference.view_type
                    );

                    if (preferredViewIndex !== -1) {
                        const [selectedView] = action.views.splice(preferredViewIndex, 1);
                        action.views = [selectedView, ...action.views];
                        
                        action.view_type = preference.view_type;
                        action.view_mode = action.views.map(v => v[1]).join(',');
                        
                        action.context = {
                            ...(action.context || {}),
                            view_type: preference.view_type,
                            force_view_type: preference.view_type,
                            initial_view: preference.view_type
                        };

                        if (action.context?.default_view_type) {
                            delete action.context.default_view_type;
                        }
                    }
                }
            } catch (error) {
                console.warn('[ViewPreference] Error applying preference:', error);
            }
            
            return action;
        };

        const originalLoadAction = env.services.action.loadAction;
        env.services.action.loadAction = async function(actionRequest, context = {}) {
            const action = await originalLoadAction.call(this, actionRequest, context);
            if (action?.type === 'ir.actions.act_window') {
                return applyPreferenceToAction(action);
            }
            return action;
        };

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

        const originalSwitchView = env.services.action.switchView;
        env.services.action.switchView = async function(viewType, props = {}) {
            try {
                if (this.currentController?.action) {
                    const action = this.currentController.action;
                    
                    const viewIndex = action.views.findIndex(v => 
                        v[1] === viewType
                    );
                    
                    if (viewIndex !== -1) {
                        const [selectedView] = action.views.splice(viewIndex, 1);
                        action.views = [selectedView, ...action.views];
                        action.view_mode = action.views.map(v => v[1]).join(',');
                        action.view_type = viewType;
                        
                        action.context = {
                            ...(action.context || {}),
                            view_type: viewType,
                            force_view_type: viewType,
                            initial_view: viewType
                        };

                        await _saveViewPreference(
                            env,
                            action.res_model,
                            viewType,
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
            pushState,
            _saveViewPreference,
        };
    },
};

// Register service
registry.category("services").add("lastViewPreferenceLoader", lastViewPreferenceLoader); 