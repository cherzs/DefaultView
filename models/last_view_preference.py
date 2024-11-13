from odoo import models, fields, api
import logging

_logger = logging.getLogger(__name__)

class LastViewPreference(models.Model):
    _name = 'last.view.preference'
    _description = 'Last View Preference'

    user_id = fields.Many2one('res.users', string='User', required=True)
    model_name = fields.Char(string='Model Name', required=True)
    last_view = fields.Selection([
        ('kanban', 'Kanban'),
        ('list', 'List'),
        ('form', 'Form'),
        ('calendar', 'Calendar'),
        ('graph', 'Graph'),
        ('map', 'Map'),
        ('activity', 'Activity')
    ], string='Last View', required=True)

    _sql_constraints = [
        ('unique_user_model', 'unique(user_id, model_name)', 'The view memory must be unique per user and model.')
    ]

    @api.model
    def create(self, vals):
        _logger.info(f'Creating view preference: {vals}')
        return super().create(vals)

    def write(self, vals):
        _logger.info(f'Updating view preference: {vals}')
        return super().write(vals)


class ResUsers(models.Model):
    _inherit = 'res.users'

    def set_last_view(self, model_name, view_type):
        _logger.info(f'Setting last view for user {self.name} ({self.id}): {model_name} - {view_type}')
        
        # Menggunakan search dan write/create alih-alih SQL mentah
        view_preference = self.env['last.view.preference'].search([
            ('user_id', '=', self.id),
            ('model_name', '=', model_name)
        ], limit=1)

        if view_preference:
            # Jika preferensi sudah ada, lakukan update
            view_preference.write({'last_view': view_type})
        else:
            # Jika preferensi belum ada, lakukan create
            self.env['last.view.preference'].create({
                'user_id': self.id,
                'model_name': model_name,
                'last_view': view_type
            })
        
        _logger.info(f'View preference saved for {model_name}: {view_type}')
        return True

    def get_last_view(self, model_name):
        _logger.info(f'Getting last view for user {self.name} ({self.id}): {model_name}')
        
        # Menggunakan pencarian ORM untuk mendapatkan preferensi terakhir
        view_preference = self.env['last.view.preference'].search([
            ('user_id', '=', self.id),
            ('model_name', '=', model_name)
        ], order="write_date desc", limit=1)
        
        if view_preference:
            view_type = view_preference.last_view
            _logger.info(f'Found view preference: {view_type}')
            return view_type
        
        _logger.info('No view preference found')
        return False
