/** @odoo-module **/
import { ActionContainer } from '@web/webclient/actions/action_container';
import { patch } from "@web/core/utils/patch";
import { onWillDestroy } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

patch(ActionContainer.prototype, {
    setup() {
        this.info = {};
        this.orm = useService("orm");
        this.onActionManagerUpdate = async ({ detail: info }) => {
            const currentViewType = info.componentProps?.type;
            console.log('[ViewPreference] Current view type:', currentViewType);

            if (!currentViewType && info.componentProps?.resModel) {
                const lastView = await this.orm.call('last.view.preference', 'get_last_view_for_model', [info.componentProps.resModel], {})
                if (lastView) {
                    info.componentProps.type = lastView;
                    console.log('[ViewPreference] Applied last view:', lastView);
                }
            }
            
            this.info = info;
            this.render();
        }; 
        
        this.env.bus.addEventListener("ACTION_MANAGER:UPDATE", this.onActionManagerUpdate);
        onWillDestroy(() => {
            this.env.bus.removeEventListener("ACTION_MANAGER:UPDATE", this.onActionManagerUpdate);
        });
    }
});