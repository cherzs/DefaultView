/** @odoo-module **/

import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { Component, useState } from "@odoo/owl";

// Get action service from registry
const actionService = registry.category("services").get("action");

// Add menu service
const menuService = registry.category("services").get("menu");

const ViewPreferenceManager = {
    async getPreference(env, model, actionId) {
        const orm = env.services.orm;
        try {
            // Get preference from database
            const preference = await orm.searchRead(
                'last.view.preference',
                [
                    ['user_id', '=', env.session.uid],
                    ['model_name', '=', model],
                    ['action_id', '=', actionId],
                    ['active', '=', true]
                ],
                ['view_type'],
                { limit: 1 }
            );

            console.log('[ViewPreference] Retrieved preference:', {
                model,
                actionId,
                preference: preference[0]?.view_type
            });

            return preference[0]?.view_type || null;
        } catch (error) {
            console.error('[ViewPreference] Error getting preference:', error);
            return null;
        }
    },

    reorderViews(views, preferredViewType) {
        if (!preferredViewType || !Array.isArray(views)) return views;

        try {
            // Deep clone views array
            const viewsCopy = JSON.parse(JSON.stringify(views));
            
            // Find preferred view
            const preferredViewIndex = viewsCopy.findIndex(v => v[1] === preferredViewType);
            if (preferredViewIndex === -1) return viewsCopy;

            // Move preferred view to front (unless it's form view)
            if (preferredViewType !== 'form') {
                const preferredView = viewsCopy.splice(preferredViewIndex, 1)[0];
                viewsCopy.unshift(preferredView);
            }

            return viewsCopy;
        } catch (error) {
            console.error('[ViewPreference] Error reordering views:', error);
            return views;
        }
    },

    async savePreference(env, model, viewType, actionId) {
        const orm = env.services.orm;
        try {
            await orm.call(
                'last.view.preference',
                'save_last_view',
                [],
                {
                    model_name: model,
                    view_type: viewType,
                    action_id: actionId
                }
            );
            return true;
        } catch (error) {
            console.error('[ViewPreference] Error saving preference:', error);
            return false;
        }
    },

    _preferenceCache: new Map(),
    
    clearCache() {
        this._preferenceCache.clear();
    },
    
    getCached(model, actionId) {
        return this._preferenceCache.get(`${model}_${actionId}`);
    },
    
    setCache(model, actionId, preference) {
        this._preferenceCache.set(`${model}_${actionId}`, preference);
    }
};

// Perbaikan ViewState initialization
const ViewState = {
    state: {
        currentView: null,
        currentModel: null,
        currentAction: null,
        isUserAction: false,
        lastSavedPreference: null,
        isProcessing: false,
        breadcrumbs: [],
        uncommittedChanges: false
    },

    updateState(newState) {
        if (!newState) return; // Guard clause untuk newState null/undefined
        
        // Pastikan state ada sebelum update
        if (!this.state) {
            this.state = {
                currentView: null,
                currentModel: null,
                currentAction: null,
                isUserAction: false,
                lastSavedPreference: null,
                isProcessing: false,
                breadcrumbs: [],
                uncommittedChanges: false
            };
        }

        // Update state dengan safe copy
        Object.assign(this.state, JSON.parse(JSON.stringify(newState)));
    },

    clearState() {
        // Reset state dengan nilai default
        this.state = {
            currentView: null,
            currentModel: null,
            currentAction: null,
            isUserAction: false,
            lastSavedPreference: null,
            isProcessing: false,
            breadcrumbs: [],
            uncommittedChanges: false
        };
    },

    async saveState() {
        if (this.state.currentView && this.state.currentModel && this.state.currentAction) {
            sessionStorage.setItem('viewState', JSON.stringify({
                view: this.state.currentView,
                model: this.state.currentModel,
                action: this.state.currentAction,
                timestamp: new Date().getTime()
            }));
        }
    },

    async loadState() {
        try {
            const stored = sessionStorage.getItem('viewState');
            if (stored) {
                const state = JSON.parse(stored);
                // Validate state data
                if (state.view && state.model && state.action) {
                    this.updateState({
                        currentView: state.view,
                        currentModel: state.model,
                        currentAction: state.action
                    });
                    return true;
                }
            }
        } catch (error) {
            console.error('[ViewPreference] Error loading state:', error);
        }
        return false;
    }
};

class LastViewPreference extends Component {
    static template = "DefaultView.LastViewPreference";

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        
        // Initialize state dengan deep copy dari ViewState
        this.state = useState({
            viewState: JSON.parse(JSON.stringify(ViewState.state)), // Deep copy
            preferences: {},
            isLoading: false
        });

        // Bind methods
        this._boundHandleViewSwitch = this._handleViewSwitch.bind(this);
        this._boundSaveCurrentView = this._saveCurrentView.bind(this);
        this._boundUpdateCurrentState = this._updateCurrentState.bind(this);

        // Event listeners
        this.env.bus.addEventListener('VIEW_SWITCHER:CLICK', async (event) => {
            const viewType = event.detail?.viewType;
            if (viewType) {
                this.state.viewState.isUserAction = true;
                this.state.viewState.currentView = viewType;
                // Update ViewState safely
                ViewState.updateState(this.state.viewState);
                await this._saveCurrentView(false, viewType);
                await this._handleViewSwitch(event);
            }
        });

        this.env.bus.addEventListener('ACTION_MANAGER:UI-UPDATED', async () => {
            if (this.state.viewState.isUserAction) {
                await this._saveCurrentView();
            }
        });

        this.env.bus.addEventListener('USER_LOGOUT', async () => {
            if (this.state.viewState.lastSavedPreference) {
                await this._saveCurrentView(true);
            }
        });

        this.env.bus.addEventListener('ACTION_MANAGER:UPDATE', async () => {
            await this._updateCurrentState();
        });

        // Enhance dengan additional handlers
        this.env.bus.addEventListener('CLEAR-UNCOMMITTED-CHANGES', async (callbacks) => {
            if (this.state.viewState.uncommittedChanges) {
                callbacks.push(async () => {
                    const confirmed = await this.env.services.dialog.confirm(
                        this.env._t("Unsaved changes will be lost. Do you want to proceed?")
                    );
                    if (confirmed) {
                        this.state.viewState.uncommittedChanges = false;
                        return true;
                    }
                    return false;
                });
            }
        });

        // Add window unload handler
        window.addEventListener('beforeunload', this._handleBeforeUnload.bind(this));
    }

    async _handleBeforeUnload(event) {
        if (this.state.viewState.uncommittedChanges) {
            event.preventDefault();
            event.returnValue = '';
            return '';
        }
        await ViewState.saveState();
    }

    async _updateCurrentState() {
        const controller = this.action.currentController;
        if (controller?.action) {
            this.state.viewState.currentModel = controller.action.res_model;
            this.state.viewState.currentAction = controller.action.id;
            this.state.viewState.currentView = controller.view?.type;
            
            // Save state after update
            await ViewState.saveState();
        }
    }

    async _saveCurrentView(force = false, specificViewType = null) {
        if (this.state.viewState.isProcessing) return;
        
        try {
            this.state.viewState.isProcessing = true;
            this.state.isLoading = true;

            const controller = this.action.currentController;
            if (!controller?.action) return;

            const viewType = specificViewType || this.state.viewState.currentView;
            const model = this.state.viewState.currentModel;
            const actionId = this.state.viewState.currentAction;

            if ((force || this.state.viewState.isUserAction) && viewType && model && actionId) {
                await this.orm.call(
                    'last.view.preference',
                    'save_last_view',
                    [],
                    {
                        model_name: model,
                        view_type: viewType,
                        action_id: actionId
                    }
                );

                this.state.viewState.lastSavedPreference = {
                    model,
                    viewType,
                    actionId,
                    timestamp: new Date().getTime()
                };

                // Update preferences cache
                this.state.preferences[`${model}_${actionId}`] = viewType;

                console.log('[ViewPreference] Saved state:', this.state.viewState);
            }
        } catch (error) {
            console.error('[ViewPreference] Save error:', error);
        } finally {
            this.state.viewState.isProcessing = false;
            this.state.isLoading = false;
            this.state.viewState.isUserAction = false;
        }
    }

    async _handleViewSwitch(event) {
        if (this.state.viewState.isProcessing) return;

        const viewType = event.detail?.viewType;
        if (!viewType || viewType === 'form') return;

        try {
            this.state.viewState.isProcessing = true;
            const controller = this.action.currentController;
            if (!controller?.action) return;

            await this.action.doAction(
                {...controller.action},
                {
                    clearBreadcrumbs: false,
                    viewType: viewType
                }
            );
        } catch (error) {
            console.error('[ViewPreference] Switch error:', error);
        } finally {
            this.state.viewState.isProcessing = false;
        }
    }

    destroy() {
        // Remove all event listeners
        this.env.bus.removeEventListener('VIEW_SWITCHER:CLICK', this._boundHandleViewSwitch);
        this.env.bus.removeEventListener('ACTION_MANAGER:UI-UPDATED', this._boundSaveCurrentView);
        this.env.bus.removeEventListener('USER_LOGOUT', this._boundSaveCurrentView);
        this.env.bus.removeEventListener('ACTION_MANAGER:UPDATE', this._updateCurrentState);
        this.env.bus.removeEventListener('CLEAR-UNCOMMITTED-CHANGES', this._handleUncommittedChanges);
        
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        ViewState.clearState();
        super.destroy();
    }
}

// Register component
registry.category("main_components").add("LastViewPreference", {
    Component: LastViewPreference,
});

console.log("[ViewPreference] Initializing view loading override...");

async function getViewPreference(env, model) {
    const orm = env.services.orm;

    try {
        // Check database first
        const prefs = await orm.searchRead(
            'last.view.preference',
            [['user_id', '=', env.session.uid], ['model_name', '=', model]],
            ['view_type'],
            { limit: 1, order: 'write_date DESC' }
        );

        if (prefs?.length && prefs[0].view_type) {
            console.log("[ViewPreference] Using DB preference:", prefs[0].view_type);
            return prefs[0].view_type;
        }

        // Fallback to session storage
        const key = `view_pref_${env.session.uid}_${model}`;
        const stored = sessionStorage.getItem(key);
        if (stored) {
            const preference = JSON.parse(stored);
            console.log("[ViewPreference] Using session preference:", preference.view_type);
            return preference.view_type;
        }
    } catch (error) {
        console.warn("[ViewPreference] Error getting preference:", error);
    }

    return null;
}

// Enhance action service patch
patch(actionService.prototype,{
    async loadAction(actionRequest, context = {}) {
        // Check for uncommitted changes first
        const canProceed = await this._clearUncommittedChanges();
        if (!canProceed) {
            return false;
        }

        const result = await this._super(...arguments);
        
        if (result.type === 'ir.actions.act_window' && result.views) {
            try {
                // Try to load saved state first
                const hasState = await ViewState.loadState();
                if (!hasState) {
                    // Fallback to database preference
                    const preference = await ViewPreferenceManager.getPreference(
                        this.env,
                        result.res_model,
                        result.id
                    );
                    if (preference) {
                        ViewState.updateState({
                            currentView: preference,
                            currentModel: result.res_model,
                            currentAction: result.id
                        });
                    }
                }

                // Update view based on state
                if (ViewState.state.currentView) {
                    result.view_type = ViewState.state.currentView;
                }
            } catch (error) {
                console.error('[ViewPreference] Load action error:', error);
            }
        }
        
        return result;
    },

    async _clearUncommittedChanges() {
        const callbacks = [];
        this.env.bus.trigger("CLEAR-UNCOMMITTED-CHANGES", callbacks);
        const results = await Promise.all(callbacks.map(fn => fn()));
        return !results.includes(false);
    }
});

// Patch menu service
patch(menuService.prototype, 'last_view_preference_menu', {
    async selectMenu(menu) {
        if (menu.actionID) {
            try {
                // Get last view preference before menu action
                const preference = await ViewPreferenceManager.getPreference(
                    this.env,
                    menu.action?.res_model,
                    menu.actionID
                );
                
                if (preference) {
                    ViewState.updateState({
                        currentView: preference,
                        currentModel: menu.action?.res_model,
                        currentAction: menu.actionID
                    });
                }
            } catch (error) {
                console.error('[ViewPreference] Menu selection error:', error);
            }
        }
        return this._super(...arguments);
    }
});
