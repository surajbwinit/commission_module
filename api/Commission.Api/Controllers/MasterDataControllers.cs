using Commission.Api.Data;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

// =====================================================================
// Master-data CRUD controllers — light wrappers over Dapper.
// One file to keep them grouped; mirrors server/src/routes/{employees,
// roles, territories, products, customers, transactions}.js
// =====================================================================

[ApiController]
[Route("api/employees")]
public class EmployeesController : ControllerBase
{
    private readonly IDb _db;
    public EmployeesController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var rows = await _db.QueryDynamicAsync(@"
            SELECT e.*, r.name AS role_name, t.name AS territory_name
            FROM employees e
            JOIN roles r ON e.role_id = r.id
            LEFT JOIN territories t ON e.territory_id = t.id
            WHERE e.is_active = 1
            ORDER BY e.name");
        return Ok(rows);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> Get(string id)
    {
        var row = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
            SELECT e.*, r.name AS role_name, t.name AS territory_name
            FROM employees e
            JOIN roles r ON e.role_id = r.id
            LEFT JOIN territories t ON e.territory_id = t.id
            WHERE e.id = @id", new { id });
        return row is null ? NotFound(new { error = "Employee not found" }) : Ok(row);
    }
}

[ApiController]
[Route("api/roles")]
public class RolesController : ControllerBase
{
    private readonly IDb _db;
    public RolesController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.QueryDynamicAsync("SELECT * FROM roles ORDER BY level, name"));
}

[ApiController]
[Route("api/territories")]
public class TerritoriesController : ControllerBase
{
    private readonly IDb _db;
    public TerritoriesController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.QueryDynamicAsync("SELECT * FROM territories ORDER BY type, name"));
}

[ApiController]
[Route("api/products")]
public class ProductsController : ControllerBase
{
    private readonly IDb _db;
    public ProductsController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? category)
    {
        var sql = "SELECT * FROM products" +
                  (category != null ? " WHERE category = @cat" : "") +
                  " ORDER BY category, name";
        return Ok(await _db.QueryDynamicAsync(sql, new { cat = category }));
    }
}

[ApiController]
[Route("api/customers")]
public class CustomersController : ControllerBase
{
    private readonly IDb _db;
    public CustomersController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.QueryDynamicAsync(@"
            SELECT c.*, t.name AS territory_name
            FROM customers c
            LEFT JOIN territories t ON c.territory_id = t.id
            ORDER BY c.name"));
}

[ApiController]
[Route("api/transactions")]
public class TransactionsController : ControllerBase
{
    private readonly IDb _db;
    public TransactionsController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? period,
        [FromQuery] string? employeeId,
        [FromQuery] int? limit)
    {
        var lim = Math.Min(limit ?? 100, 1000);
        var clauses = new List<string>();
        var args = new Dictionary<string, object>();
        if (period != null)      { clauses.Add("t.period = @p"); args["p"] = period; }
        if (employeeId != null)  { clauses.Add("t.employee_id = @e"); args["e"] = employeeId; }
        var where = clauses.Count == 0 ? "" : " WHERE " + string.Join(" AND ", clauses);

        return Ok(await _db.QueryDynamicAsync($@"
            SELECT t.*, e.name AS employee_name, c.name AS customer_name, p.name AS product_name
            FROM transactions t
            JOIN employees e ON t.employee_id = e.id
            JOIN customers c ON t.customer_id = c.id
            JOIN products p  ON t.product_id  = p.id
            {where}
            ORDER BY t.transaction_date DESC LIMIT {lim}", args));
    }
}

// ----- Lookups (filter-values for FormulaBuilder) -----
[ApiController]
[Route("api/lookups")]
public class LookupsController : ControllerBase
{
    private readonly IDb _db;
    public LookupsController(IDb db) { _db = db; }

    [HttpGet("filter-values")]
    public async Task<IActionResult> FilterValues([FromQuery] string field)
    {
        return field switch
        {
            "product_category" => Ok((await _db.QueryAsync<string>(
                "SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category"))
                .Select(v => new { value = v, label = v })),
            "product_sku" => Ok((await _db.QueryDynamicAsync(
                "SELECT id, sku, name FROM products ORDER BY name"))
                .Select(p => new { value = (string)p.sku, label = $"{p.sku} — {p.name}" })),
            "customer_channel" => Ok((await _db.QueryDynamicAsync(
                "SELECT DISTINCT channel, channel_name FROM customers WHERE channel IS NOT NULL ORDER BY channel"))
                .Select(c => new { value = (string)c.channel, label = $"{c.channel} — {c.channel_name}" })),
            "customer_group" => Ok((await _db.QueryDynamicAsync(
                "SELECT DISTINCT customer_group, customer_group_name FROM customers WHERE customer_group IS NOT NULL ORDER BY customer_group"))
                .Select(c => new { value = (string)c.customer_group, label = $"{c.customer_group} — {c.customer_group_name}" })),
            "is_strategic" or "is_new_launch" => Ok(new[] {
                new { value = 1, label = "Yes" },
                new { value = 0, label = "No" } }),
            _ => Ok(Array.Empty<object>())
        };
    }
}
