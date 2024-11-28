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
            // The action to load isn't the current one => executes it
            actionRequest = state.action;
            context.params = state;
            Object.assign(options, {
                additionalContext: context,
                viewType: state.view_type,
            });
            if (state.id) {
                options.props = { resId: state.id };
            }
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
            const prefKey = `view_pref_${env.services.user.userId}_${state.model}`;
            const storedPref = browser.sessionStorage.getItem(prefKey);
            const lastPref = JSON.parse(storedPref || "{}");
            
            if (!lastPref.view_type) {
                const dbPref = await env.services.orm.call(
                    'last.view.preference',
                    'get_last_view_for_model',
                    [state.model]
                );
                if (dbPref.view_type) {
                    lastPref.view_type = dbPref.view_type;
                    lastPref.action_id = dbPref.action_id;
                    browser.sessionStorage.setItem(prefKey, JSON.stringify(dbPref));
                }
            }

            if (lastPref.view_type) {
                actionRequest = {
                    type: "ir.actions.act_window",
                    res_model: state.model,
                    views: [[false, lastPref.view_type]],
                    view_type: lastPref.view_type,
                    action_id: lastPref.action_id
                };
                options.viewType = lastPref.view_type;
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
    const switchViewParams = _getSwitchViewParams();
    if (switchViewParams) {
        const { viewType, props } = switchViewParams;
        const view = _getView(viewType);
        if (view) {
            await switchView(viewType, props);
            return true;
        }
    } else {
        const actionParams = await _getActionParams();
        if (actionParams) {
            const { actionRequest, options } = actionParams;
            await doAction(actionRequest, options);
            return true;
        }
    }
    return false;
}

// 6. State management
function pushState(controller) {
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
        const props = controller.props;
        newState.model = props.resModel;
        newState.view_type = props.type;
        newState.id = props.resId || (props.state && props.state.resId) || undefined;
    }
    env.services.router.pushState(newState, { replace: true });
}

// 7. Return statement
return {
    loadState,
    switchView,
    _getView,
    _getSwitchViewParams,
    _findView,
    pushState,
};

// Register service
registry.category("services").add("lastViewPreferenceLoader", lastViewPreferenceLoader); 