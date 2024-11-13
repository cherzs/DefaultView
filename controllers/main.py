from odoo import http
from odoo.http import request
import logging

_logger = logging.getLogger(__name__)

class LastViewController(http.Controller):
    @http.route('/save/last_view', type='json', auth='user')
    def save_last_view(self, model_name, view_type):
        try:
            _logger.info(f'Saving view preference for model {model_name} as view type {view_type} for user {request.env.user.id}')
            
            # Gunakan metode ORM yang sudah disesuaikan di ResUsers
            result = request.env.user.with_context(active_test=False).set_last_view(model_name, view_type)
            
            if result:
                _logger.info('View preference saved successfully')
                return True
            else:
                _logger.warning('Failed to save view preference')
                return False

        except Exception as e:
            _logger.error(f'Error saving view preference for model {model_name}: {str(e)}')
            return False
