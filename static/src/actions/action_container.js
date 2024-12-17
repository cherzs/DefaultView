/** @odoo-module **/
import { ActionContainer } from '@web/webclient/actions/action_container';
import { patch } from "@web/core/utils/patch";
import { onWillDestroy } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

patch(ActionContainer.prototype, {
    setup() {
        super.setup();
        
        this.info = {};
        this.orm = useService("orm");
        
        this.onActionManagerUpdate = async ({ detail: info }) => {
            try {
                console.log("[LastViewPreference] Action Update Info:", info);
                
                if (info && info.componentProps) {
                    console.log("[LastViewPreference] Component Props:", info.componentProps);
                    
                    if (info.componentProps.resModel) {
                        const lastView = await this.orm.call(
                            'last.view.preference', 
                            'get_last_view_for_model', 
                            [info.componentProps.resModel], 
                            {}
                        );
                        
                        console.log("[LastViewPreference] Last View Result:", lastView);
                        
                        if (lastView && lastView.view_type) {
                            const originalType = info.componentProps.type;
                            
                            info.componentProps.type = lastView.view_type;
                            
                            console.log("[LastViewPreference] View type changed from", 
                                      originalType, "to", lastView.view_type);
                        }
                    }
                }
                
                this.info = info;
                this.render();
                
            } catch (error) {
                console.error("[LastViewPreference] Error:", error);
            }
        };
        
        this.env.bus.addEventListener("ACTION_MANAGER:UPDATE", this.onActionManagerUpdate);
        
        onWillDestroy(() => {
            this.env.bus.removeEventListener("ACTION_MANAGER:UPDATE", this.onActionManagerUpdate);
        });
    }
});