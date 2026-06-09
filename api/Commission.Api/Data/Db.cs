using System.Data;
using Npgsql;
using Dapper;

namespace Commission.Api.Data;

/// <summary>
/// Connection factory + Dapper facade. Raw SQL only, no EF.
///
/// Two distinct interfaces — IDb (the commission DB, read+write) and
/// ISourceDb (the nfpcproduct ERP, read-only, for ETL). Both implementations
/// share Db's plumbing; only the connection string differs.
/// </summary>
public interface IDb
{
    Task<IDbConnection> OpenAsync(CancellationToken ct = default);
    Task<T?> QuerySingleOrDefaultAsync<T>(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default);
    Task<IEnumerable<T>> QueryAsync<T>(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default);
    Task<IEnumerable<dynamic>> QueryDynamicAsync(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default);
    Task<int> ExecuteAsync(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default);
    Task<T> InTransactionAsync<T>(Func<IDbConnection, IDbTransaction, Task<T>> work, CancellationToken ct = default);
    Task InTransactionAsync(Func<IDbConnection, IDbTransaction, Task> work, CancellationToken ct = default);
}

/// <summary>
/// Read-only handle to the source ERP (nfpcproduct). ETL syncers depend on this.
/// Same surface as IDb so callers can use the same Dapper helpers.
/// </summary>
public interface ISourceDb : IDb { }

public abstract class DbBase : IDb
{
    protected readonly string _connectionString;
    protected DbBase(string connectionString)
    {
        _connectionString = connectionString
            ?? throw new InvalidOperationException("Connection string is null.");
    }

    public async Task<IDbConnection> OpenAsync(CancellationToken ct = default)
    {
        var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        return conn;
    }

    public async Task<T?> QuerySingleOrDefaultAsync<T>(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default)
    {
        if (tx != null) return await tx.Connection!.QuerySingleOrDefaultAsync<T>(new CommandDefinition(sql, param, tx, cancellationToken: ct));
        using var conn = await OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<T>(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    public async Task<IEnumerable<T>> QueryAsync<T>(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default)
    {
        if (tx != null) return await tx.Connection!.QueryAsync<T>(new CommandDefinition(sql, param, tx, cancellationToken: ct));
        using var conn = await OpenAsync(ct);
        return await conn.QueryAsync<T>(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    public async Task<IEnumerable<dynamic>> QueryDynamicAsync(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default)
    {
        if (tx != null) return await tx.Connection!.QueryAsync(new CommandDefinition(sql, param, tx, cancellationToken: ct));
        using var conn = await OpenAsync(ct);
        return await conn.QueryAsync(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    public async Task<int> ExecuteAsync(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default)
    {
        if (tx != null) return await tx.Connection!.ExecuteAsync(new CommandDefinition(sql, param, tx, cancellationToken: ct));
        using var conn = await OpenAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    public async Task<T> InTransactionAsync<T>(Func<IDbConnection, IDbTransaction, Task<T>> work, CancellationToken ct = default)
    {
        using var conn = await OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        try { var result = await work(conn, tx); tx.Commit(); return result; }
        catch { tx.Rollback(); throw; }
    }

    public async Task InTransactionAsync(Func<IDbConnection, IDbTransaction, Task> work, CancellationToken ct = default)
    {
        await InTransactionAsync<bool>(async (c, t) => { await work(c, t); return true; }, ct);
    }
}

/// <summary>The primary commission DB connection (read+write). Resolves from ConnectionStrings:Default.</summary>
public class Db : DbBase, IDb
{
    public Db(IConfiguration config) : base(
        config.GetConnectionString("Default")
            ?? Environment.GetEnvironmentVariable("DATABASE_URL")
            ?? throw new InvalidOperationException(
                "Commission DB connection string missing. Set ConnectionStrings:Default or DATABASE_URL."))
    {
    }
}

/// <summary>The source ERP connection (read-only). Resolves from ConnectionStrings:Source.</summary>
public class SourceDb : DbBase, ISourceDb
{
    public SourceDb(IConfiguration config) : base(
        config.GetConnectionString("Source")
            ?? Environment.GetEnvironmentVariable("SOURCE_DATABASE_URL")
            ?? throw new InvalidOperationException(
                "Source DB connection string missing. Set ConnectionStrings:Source or SOURCE_DATABASE_URL."))
    {
    }
}
