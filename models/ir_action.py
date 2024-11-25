from odoo import models, fields, api
import logging
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)

class IrActionsActWindowInherit(models.Model):
    _inherit = 'ir.actions.act_window'

    def read(self, fields=None, load='_classic_read'):
        """Override read to force view mode order."""
        result = super().read(fields, load)
        
        # Handle single record
        if isinstance(result, dict):
            return self._force_view_mode(result)
        # Handle multiple records
        return [self._force_view_mode(res) for res in result]

    def _force_view_mode(self, action_data):
        """Force view mode order based on last view preference."""
        if not action_data or not action_data.get('res_model'):
            return action_data

        try:
            model_name = action_data.get('res_model')
            action_id = action_data.get('id')

            # Get last view preference for this model
            last_preference = self.env['last.view.preference'].search([
                ('model_name', '=', model_name),
                ('action_id', '=', action_id),
                ('active', '=', True),
                ('user_id', '=', self.env.uid)
            ], limit=1)

            if last_preference:
                # Get original view modes
                original_view_modes = action_data.get('view_mode', '').split(',')
                
                if last_preference.view_type in original_view_modes:
                    # Reorder view modes putting last used view first
                    new_view_modes = [last_preference.view_type] + [
                        mode for mode in original_view_modes 
                        if mode != last_preference.view_type
                    ]
                    
                    # Update view_mode string
                    action_data['view_mode'] = ','.join(new_view_modes)
                    action_data['mobile_view_mode'] = last_preference.view_type

                    # Update views order if present
                    if action_data.get('views'):
                        views = action_data['views']
                        view_map = {v[1]: v[0] for v in views}
                        
                        # Create new views list with preferred view first
                        new_views = [[view_map.get(mode, False), mode] for mode in new_view_modes]
                        action_data['views'] = new_views
                    
                    _logger.info(
                        f"Forced view mode for {model_name}: "
                        f"view_mode={action_data['view_mode']}, "
                        f"mobile_view_mode={action_data['mobile_view_mode']}"
                    )
                    
                    # Force update in database
                    self.env.cr.execute("""
                        UPDATE ir_act_window 
                        SET view_mode = %s,
                            mobile_view_mode = %s
                        WHERE id = %s
                    """, (
                        action_data['view_mode'],
                        action_data['mobile_view_mode'],
                        action_id
                    ))
                    
                    # Clear caches
                    self.invalidate_cache(
                        fnames=['view_mode', 'mobile_view_mode'],
                        ids=[action_id]
                    )
                    self.env.registry.clear_caches()
                
        except Exception as e:
            _logger.error(f"Error forcing view mode: {str(e)}")
            
        return action_data

